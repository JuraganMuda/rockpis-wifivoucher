const fs = require("fs");
const path = require("path");
const https = require("https");
const fastify = require("fastify")({ logger: true });
const mysql = require("mysql2/promise");

// Environment variables
const API_KEY = process.env.API_KEY || "rahasia-appsheet-123";
const ADMIN_PIN = process.env.ADMIN_PIN || "123456";
const DB_HOST = process.env.DB_HOST || "db";
const DB_USER = process.env.DB_USER || "radius";
const DB_PASSWORD = process.env.DB_PASSWORD || "radius_password";
const DB_NAME = process.env.DB_NAME || "radius_db";

let pool;

// Register plugins
fastify.register(require("@fastify/formbody"));
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "public"),
  prefix: "/",
});

// Helper untuk mengirim perintah instan ke OpenNDS melalui file antrean Watchdog (< 1 detik)
function queueNdsAction(action, target) {
  if (!target) return;
  try {
    const line = `${action.toUpperCase()} ${target.trim()}\n`;
    fs.appendFileSync("/tmp/nds_action_queue", line);
    fastify.log.info(`[Queue NDS Action] ${line.trim()}`);
  } catch (err) {
    fastify.log.error(`[Queue NDS Action Error] ${err.message}`);
  }
}

// Helper untuk membaca MAC Address dari ARP table Linux (/proc/net/arp)
function getMacFromArp(ip) {
  try {
    if (fs.existsSync("/proc/net/arp")) {
      const arpData = fs.readFileSync("/proc/net/arp", "utf8");
      const lines = arpData.split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === ip && parts[3] && parts[3] !== "00:00:00:00:00:00") {
          return parts[3].toLowerCase();
        }
      }
    }
  } catch (err) {
    fastify.log.error(err);
  }
  return null;
}

// Helper untuk membaca dump status OpenNDS dari watchdog (/tmp/nds_live_status.json)
function getOpenNdsLiveStatus() {
  try {
    if (fs.existsSync("/tmp/nds_live_status.json")) {
      const raw = fs.readFileSync("/tmp/nds_live_status.json", "utf8");
      let sanitized = "";
      let inString = false;
      let escaped = false;
      for (let i = 0; i < raw.length; i++) {
        const char = raw[i];
        if (escaped) {
          sanitized += char;
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          sanitized += char;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          sanitized += char;
          continue;
        }
        if (inString) {
          if (char === "\n") {
            sanitized += "\\n";
            continue;
          }
          if (char === "\r") {
            sanitized += "\\r";
            continue;
          }
          if (char === "\t") {
            sanitized += "\\t";
            continue;
          }
        }
        sanitized += char;
      }
      return JSON.parse(sanitized);
    }
  } catch (err) {
    fastify.log.warn(`OpenNDS live status parse warning: ${err.message}`);
  }
  return null;
}

// Utility to generate random code
function generateVoucherCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Helper untuk menormalisasi nomor HP ke format Indonesia 62xxx
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  let clean = String(phone).replace(/[^0-9]/g, "");
  if (!clean) return null;
  if (clean.startsWith("08")) {
    clean = "62" + clean.substring(1);
  } else if (clean.startsWith("8")) {
    clean = "62" + clean;
  } else if (clean.startsWith("0062")) {
    clean = clean.substring(2);
  } else if (!clean.startsWith("62") && clean.length >= 8) {
    clean = "62" + clean;
  }
  return clean;
}

// Helper format tanggal bahasa Indonesia: contoh "12 Sept 2026 pukul 15:00"
function formatExpirationIndo(dateObj) {
  if (!dateObj) return "-";
  const d = new Date(dateObj);
  if (isNaN(d.getTime())) return "-";

  const months = [
    "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
    "Jul", "Agu", "Sept", "Okt", "Nov", "Des"
  ];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");

  return `${day} ${month} ${year} pukul ${hours}:${mins}`;
}

// Helper mendapatkan nama paket human-readable dari durasi menit
function formatDurationPackage(minutes) {
  const m = Number(minutes) || 0;
  if (m === 1440) return "24 Jam / 1 Hari";
  if (m === 4320) return "3 Hari";
  if (m === 10080) return "7 Hari";
  if (m >= 1440) {
    const days = Math.round(m / 1440);
    return `${days} Hari`;
  }
  if (m >= 60) {
    const hours = Math.round(m / 60);
    return `${hours} Jam`;
  }
  return `${m} Menit`;
}

// Helper membaca seluruh settings dari database
async function getAllSettings() {
  try {
    const [rows] = await pool.execute("SELECT setting_key, setting_value FROM settings");
    const config = {};
    for (const r of rows) {
      config[r.setting_key] = r.setting_value;
    }
    return config;
  } catch (e) {
    return {
      business_name: "RTNA Wi-Fi",
      wifi_ssid: "RTNA WiFi Voucher",
      login_portal_url: "http://10.0.0.1:3000",
      fonnte_token: "",
      wa_template: ""
    };
  }
}

// Helper kirim pesan WhatsApp via Fonnte API (HTTPS Non-blocking native)
function sendFonnteWhatsApp({ token, target, message }) {
  return new Promise((resolve, reject) => {
    if (!token) {
      return reject(new Error("Token Fonnte belum dikonfigurasi di Pengaturan Admin"));
    }
    if (!target) {
      return reject(new Error("Nomor target WhatsApp kosong"));
    }

    const postData = JSON.stringify({
      target: target,
      message: message,
      countryCode: "62"
    });

    const options = {
      hostname: "api.fonnte.com",
      port: 443,
      path: "/send",
      method: "POST",
      headers: {
        "Authorization": token.trim(),
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      },
      timeout: 10000 // 10 detik timeout
    };

    const req = https.request(options, (res) => {
      let rawData = "";
      res.on("data", (chunk) => { rawData += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(rawData);
          if (parsed.status === true || parsed.status === "true") {
            resolve(parsed);
          } else {
            reject(new Error(parsed.reason || parsed.message || "Fonnte menolak pengiriman"));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ raw: rawData });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${rawData.slice(0, 100)}`));
          }
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Koneksi ke API Fonnte timeout (10 detik)"));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

// Fungsi latar belakang untuk menyusun template pesan dan mengirim WA ke voucher
async function dispatchVoucherWhatsApp(voucherId) {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM vouchers WHERE id = ?",
      [voucherId]
    );
    if (rows.length === 0) return;
    const v = rows[0];

    const phone = normalizePhoneNumber(v.phone_number);
    if (!phone) return;

    const settings = await getAllSettings();
    const token = settings.fonnte_token;
    if (!token) {
      await pool.execute(
        "UPDATE vouchers SET wa_status = 'failed', wa_error = 'Token Fonnte belum diisi di Pengaturan' WHERE id = ?",
        [voucherId]
      );
      return;
    }

    const custName = v.customer_name || "Pelanggan";
    const bizName = settings.business_name || "RTNA Wi-Fi";
    const wifiSsid = settings.wifi_ssid || "RTNA WiFi Voucher";
    const portalUrl = settings.login_portal_url || "http://10.0.0.1:3000";
    const packageName = formatDurationPackage(v.duration_minutes);
    const expIndo = formatExpirationIndo(v.expires_at);

    let template = settings.wa_template || "";
    if (!template.trim()) {
      template = 'Halo *{nama}*, terima kasih telah menggunakan layanan *{nama_usaha}*!\n\nBerikut adalah rincian voucher internet Anda:\n🎫 Kode Voucher: *{kode}*\n📦 Paket: *{paket}*\n⏳ Masa Aktif: Berlaku hingga *{berlaku_hingga}*\n\n💡 *PANDUAN JIKA KONEKSI TERPUTUS / GANTI HP / LUPA JARINGAN:*\n1. Sambungkan kembali HP Anda ke Wi-Fi: *{nama_wifi}*\n2. Buka browser dan akses portal: {portal_url}\n3. Masukkan kembali Kode Voucher Anda (*{kode}*) lalu klik "Hubungkan".\n\nSimpan pesan ini agar nomor voucher Anda tidak hilang. Selamat menikmati internet!';
    }

    // Replace placeholders
    const message = template
      .replace(/\{nama\}/gi, custName)
      .replace(/\{kode\}/gi, v.code)
      .replace(/\{paket\}/gi, packageName)
      .replace(/\{berlaku_hingga\}/gi, expIndo)
      .replace(/\{nama_usaha\}/gi, bizName)
      .replace(/\{nama_wifi\}/gi, wifiSsid)
      .replace(/\{portal_url\}/gi, portalUrl);

    // Update status to pending
    await pool.execute(
      "UPDATE vouchers SET wa_status = 'pending' WHERE id = ?",
      [voucherId]
    );

    // Kirim pesan via Fonnte
    await sendFonnteWhatsApp({
      token: token,
      target: phone,
      message: message
    });

    // Berhasil
    await pool.execute(
      "UPDATE vouchers SET wa_status = 'sent', wa_error = NULL, wa_sent_at = NOW() WHERE id = ?",
      [voucherId]
    );
    fastify.log.info(`[Fonnte WA Sent] Berhasil kirim pesan voucher ${v.code} ke ${phone}`);
  } catch (err) {
    fastify.log.error(`[Fonnte WA Failed] Gagal kirim ke voucher ${voucherId}: ${err.message}`);
    await pool.execute(
      "UPDATE vouchers SET wa_status = 'failed', wa_error = ? WHERE id = ?",
      [err.message.substring(0, 250), voucherId]
    );
  }
}

// Initialize DB connection & Safe Schema Migration
fastify.addHook("onReady", async () => {
  pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    timezone: "+00:00",
  });

  // Skrip Migrasi Otomatis Skema Database
  try {
    const [columns] = await pool.execute("SHOW COLUMNS FROM vouchers");
    const colNames = columns.map((c) => c.Field);

    if (!colNames.includes("customer_name")) {
      await pool.execute(
        "ALTER TABLE vouchers ADD COLUMN customer_name VARCHAR(100) NULL AFTER code"
      );
      fastify.log.info("Migrated: Added customer_name column to vouchers");
    }
    if (!colNames.includes("phone_number")) {
      await pool.execute(
        "ALTER TABLE vouchers ADD COLUMN phone_number VARCHAR(30) NULL AFTER customer_name"
      );
      fastify.log.info("Migrated: Added phone_number column to vouchers");
    }
    if (!colNames.includes("wa_status")) {
      await pool.execute(
        "ALTER TABLE vouchers ADD COLUMN wa_status ENUM('none', 'pending', 'sent', 'failed') NOT NULL DEFAULT 'none' AFTER status"
      );
      fastify.log.info("Migrated: Added wa_status column to vouchers");
    }
    if (!colNames.includes("wa_error")) {
      await pool.execute(
        "ALTER TABLE vouchers ADD COLUMN wa_error VARCHAR(255) NULL AFTER wa_status"
      );
      fastify.log.info("Migrated: Added wa_error column to vouchers");
    }
    if (!colNames.includes("wa_sent_at")) {
      await pool.execute(
        "ALTER TABLE vouchers ADD COLUMN wa_sent_at DATETIME NULL AFTER wa_error"
      );
      fastify.log.info("Migrated: Added wa_sent_at column to vouchers");
    }
    if (!colNames.includes("ip_address")) {
      await pool.execute(
        "ALTER TABLE vouchers ADD COLUMN ip_address VARCHAR(45) NULL AFTER mac"
      );
      fastify.log.info("Migrated: Added ip_address column to vouchers");
    }
    if (!colNames.includes("last_seen")) {
      await pool.execute(
        "ALTER TABLE vouchers ADD COLUMN last_seen DATETIME NULL AFTER expires_at"
      );
      fastify.log.info("Migrated: Added last_seen column to vouchers");
    }

    // Perluas enum status agar mendukung 'revoked'
    await pool.execute(
      "ALTER TABLE vouchers MODIFY COLUMN status ENUM('active', 'used', 'expired', 'revoked') NOT NULL DEFAULT 'active'"
    );

    // Buat tabel settings jika belum ada
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value TEXT NOT NULL
      )
    `);

    // Inisialisasi default settings jika kosong
    const defaultSettings = [
      ['business_name', 'RTNA Wi-Fi'],
      ['wifi_ssid', 'RTNA WiFi Voucher'],
      ['login_portal_url', 'http://10.0.0.1:3000'],
      ['fonnte_token', ''],
      ['wa_template', 'Halo *{nama}*, terima kasih telah menggunakan layanan *{nama_usaha}*!\n\nBerikut adalah rincian voucher internet Anda:\n🎫 Kode Voucher: *{kode}*\n📦 Paket: *{paket}*\n⏳ Masa Aktif: Berlaku hingga *{berlaku_hingga}*\n\n💡 *PANDUAN JIKA KONEKSI TERPUTUS / GANTI HP / LUPA JARINGAN:*\n1. Sambungkan kembali HP Anda ke Wi-Fi: *{nama_wifi}*\n2. Buka browser dan akses portal: {portal_url}\n3. Masukkan kembali Kode Voucher Anda (*{kode}*) lalu klik "Hubungkan".\n\nSimpan pesan ini agar nomor voucher Anda tidak hilang. Selamat menikmati internet!']
    ];

    for (const [k, v] of defaultSettings) {
      await pool.execute(
        'INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)',
        [k, v]
      );
    }
  } catch (err) {
    fastify.log.warn(`Database migration check note: ${err.message}`);
  }
});

// Helper Verifikasi Admin (PIN atau API Key dari Header, Body, atau Query)
function isAdminAuthorized(request) {
  let headerKey = request.headers["x-api-key"];
  if (headerKey && typeof headerKey === "string") {
    headerKey = headerKey.trim().replace(/^["']|["']$/g, "");
  }
  const headerPin = request.headers["x-admin-pin"];
  const queryPin = request.query ? request.query.pin : null;
  const bodyPin = request.body ? request.body.pin : null;
  const bodyKey = request.body ? (request.body.apiKey || request.body["x-api-key"]) : null;
  const queryKey = request.query ? (request.query.apiKey || request.query["x-api-key"]) : null;

  return (
    headerKey === API_KEY ||
    bodyKey === API_KEY ||
    queryKey === API_KEY ||
    headerPin === ADMIN_PIN ||
    queryPin === ADMIN_PIN ||
    bodyPin === ADMIN_PIN
  );
}

// Route GET /admin - Melayani Halaman Admin Live Monitoring Dashboard
fastify.get("/admin", async (request, reply) => {
  return reply.sendFile("admin.html");
});

// POST /api/admin/auth - Verifikasi PIN Admin untuk login dashboard
fastify.post("/api/admin/auth", async (request, reply) => {
  const { pin } = request.body || {};
  if (pin === ADMIN_PIN || pin === API_KEY) {
    return reply.send({ success: true, message: "PIN Valid" });
  }
  return reply.code(401).send({ success: false, message: "PIN Admin salah" });
});

// GET /api/settings - Mengambil informasi publik atau konfigurasi lengkap jika admin
fastify.get("/api/settings", async (request, reply) => {
  try {
    const settings = await getAllSettings();
    const isAuth = isAdminAuthorized(request);

    if (isAuth) {
      return reply.send({
        success: true,
        settings: settings
      });
    }

    // Publik hanya menerima data umum untuk branding halaman splash
    return reply.send({
      success: true,
      settings: {
        business_name: settings.business_name || "RTNA Wi-Fi",
        wifi_ssid: settings.wifi_ssid || "RTNA WiFi Voucher",
        login_portal_url: settings.login_portal_url || "http://10.0.0.1:3000"
      }
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Failed to fetch settings" });
  }
});

// POST /api/admin/settings - Menyimpan konfigurasi bisnis & Fonnte oleh Admin
fastify.post("/api/admin/settings", async (request, reply) => {
  if (!isAdminAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const { business_name, wifi_ssid, login_portal_url, fonnte_token, wa_template } = request.body || {};

  try {
    const updates = [
      ['business_name', (business_name || "").trim()],
      ['wifi_ssid', (wifi_ssid || "").trim()],
      ['login_portal_url', (login_portal_url || "").trim()],
      ['fonnte_token', (fonnte_token || "").trim()],
      ['wa_template', (wa_template || "").trim()]
    ];

    for (const [key, val] of updates) {
      await pool.execute(
        "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
        [key, val]
      );
    }

    return reply.send({
      success: true,
      message: "Pengaturan bisnis & Fonnte WhatsApp berhasil disimpan!"
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Failed to save settings" });
  }
});

// POST /api/admin/test-wa - Uji Coba Pengiriman WhatsApp via Token Fonnte
fastify.post("/api/admin/test-wa", async (request, reply) => {
  if (!isAdminAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const { phone_number, fonnte_token } = request.body || {};
  const phone = normalizePhoneNumber(phone_number);

  if (!phone) {
    return reply.code(400).send({ success: false, message: "Nomor WhatsApp target diperlukan (contoh: 0812xxx)" });
  }

  try {
    let token = (fonnte_token || "").trim();
    if (!token) {
      const settings = await getAllSettings();
      token = settings.fonnte_token;
    }

    if (!token) {
      return reply.code(400).send({ success: false, message: "Token Fonnte belum diisi" });
    }

    const testMsg = `*TES KONEKSI FONNTE WHATSAPP*\n\nHalo Admin! Ini adalah pesan uji coba dari sistem Hotspot RTNA Wi-Fi Rock Pi S.\nToken WhatsApp Fonnte Anda berfungsi dengan sangat baik! 🚀`;

    const res = await sendFonnteWhatsApp({
      token: token,
      target: phone,
      message: testMsg
    });

    return reply.send({
      success: true,
      message: `Pesan uji coba berhasil dikirim ke nomor +${phone}!`,
      response: res
    });
  } catch (err) {
    return reply.code(400).send({
      success: false,
      message: `Gagal mengirim WhatsApp: ${err.message}`
    });
  }
});

// POST /api/admin/voucher/edit - Edit Data Pelanggan (Nama & No WA)
fastify.post("/api/admin/voucher/edit", async (request, reply) => {
  if (!isAdminAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const { id, customer_name, phone_number } = request.body || {};
  if (!id) {
    return reply.code(400).send({ error: "ID Voucher diperlukan" });
  }

  try {
    const custName = (customer_name || "").trim() || null;
    const phone = normalizePhoneNumber(phone_number) || null;

    await pool.execute(
      "UPDATE vouchers SET customer_name = ?, phone_number = ? WHERE id = ?",
      [custName, phone, id]
    );

    return reply.send({
      success: true,
      message: "Data pelanggan berhasil diperbarui",
      voucher: { id, customer_name: custName, phone_number: phone }
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Database error" });
  }
});

// POST /api/admin/voucher/resend-wa - Tombol Kirim Ulang Pesan WhatsApp
fastify.post("/api/admin/voucher/resend-wa", async (request, reply) => {
  if (!isAdminAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const { id } = request.body || {};
  if (!id) {
    return reply.code(400).send({ error: "ID Voucher diperlukan" });
  }

  try {
    const [rows] = await pool.execute("SELECT * FROM vouchers WHERE id = ?", [id]);
    if (rows.length === 0) {
      return reply.code(404).send({ error: "Voucher tidak ditemukan" });
    }

    const v = rows[0];
    if (!v.phone_number) {
      return reply.code(400).send({
        success: false,
        message: "Voucher ini belum memiliki nomor WhatsApp pelanggan. Silahkan gunakan fitur Edit untuk menambahkan nomor terlebih dahulu."
      });
    }

    // Jalankan pengiriman sekarang
    await dispatchVoucherWhatsApp(v.id);

    // Ambil status terbaru
    const [updatedRows] = await pool.execute("SELECT wa_status, wa_error, wa_sent_at FROM vouchers WHERE id = ?", [id]);
    const updated = updatedRows[0];

    if (updated.wa_status === "sent") {
      return reply.send({
        success: true,
        message: `Pesan WhatsApp berhasil dikirim ulang ke +${normalizePhoneNumber(v.phone_number)}!`
      });
    } else {
      return reply.code(400).send({
        success: false,
        message: `Gagal mengirim pesan: ${updated.wa_error || "Terjadi kesalahan pada gateway Fonnte"}`
      });
    }
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
});

// POST /api/generate - Dipanggil oleh AppSheet atau Dashboard Admin
fastify.post("/api/generate", async (request, reply) => {
  const body = request.body || {};
  let apiKey = request.headers["x-api-key"] || body.apiKey || body["x-api-key"];
  if (apiKey && typeof apiKey === "string") {
    apiKey = apiKey.trim().replace(/^["']|["']$/g, "");
  }
  const isAuth = apiKey === API_KEY || body.pin === ADMIN_PIN;

  if (apiKey && !isAuth) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  let { duration_minutes, code: providedCode, Status, Assignee, Title, customer_name, phone_number, Phone, no_wa, whatsapp } = body;

  // 1. Konversi Status AppSheet ("24 Jam/1 Hari", "3 Hari", "7 Hari", dll) ke duration_minutes
  if (!duration_minutes && Status) {
    const statusStr = String(Status).toLowerCase();
    if (statusStr.includes("24 jam") || statusStr.includes("1 hari")) {
      duration_minutes = 1440; // 24 jam
    } else if (statusStr.includes("3 hari")) {
      duration_minutes = 4320; // 3 hari
    } else if (statusStr.includes("7 hari")) {
      duration_minutes = 10080; // 7 hari
    } else {
      const match = statusStr.match(/(\d+)\s*(jam|hari|menit|hour|day|minute)/);
      if (match) {
        const val = parseInt(match[1]);
        const unit = match[2];
        if (unit.startsWith("jam") || unit.startsWith("hour")) duration_minutes = val * 60;
        else if (unit.startsWith("hari") || unit.startsWith("day")) duration_minutes = val * 1440;
        else duration_minutes = val;
      }
    }
  }

  // Default jika tidak terdeteksi: 1440 menit (24 jam)
  if (!duration_minutes) {
    duration_minutes = 1440;
  }

  // 2. Ambil nama pelanggan dari AppSheet atau Form Admin
  const custName = (customer_name || Title || Assignee || "").trim() || null;

  // 3. Normalisasi nomor WhatsApp (jika disediakan)
  const rawPhone = phone_number || Phone || no_wa || whatsapp || "";
  const phone = normalizePhoneNumber(rawPhone);

  // 4. Ambil kode voucher (dari providedCode jika dibuat AppSheet, atau generate baru)
  const code = (providedCode || generateVoucherCode()).toUpperCase().trim();

  try {
    const [result] = await pool.execute(
      "INSERT INTO vouchers (code, customer_name, phone_number, duration_minutes, status) VALUES (?, ?, ?, ?, 'active') ON DUPLICATE KEY UPDATE customer_name = VALUES(customer_name), phone_number = VALUES(phone_number), duration_minutes = VALUES(duration_minutes), status = 'active'",
      [code, custName, phone, duration_minutes]
    );

    return reply.send({
      success: true,
      code: code,
      customer_name: custName,
      phone_number: phone,
      duration_minutes: duration_minutes,
      voucher: { id: result.insertId, code, customer_name: custName, phone_number: phone, duration_minutes },
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Database error" });
  }
});

// POST /api/revoke (atau /api/delete) - Dipanggil saat Hapus Voucher di AppSheet atau Dashboard Admin
// Langsung memutuskan internet user detik itu juga (< 1 detik)!
const handleRevoke = async (request, reply) => {
  if (!isAdminAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const body = request.body || {};
  let { code, mac, id, Assignee, Title, Code, kode, voucher } = body;
  code = code || Assignee || Code || kode || voucher;

  if (!code && !mac && !id) {
    return reply.code(400).send({ error: "Kode voucher, MAC, atau ID diperlukan" });
  }

  try {
    // Cari data voucher
    let query = "SELECT * FROM vouchers WHERE ";
    let params = [];
    if (id) {
      query += "id = ?";
      params.push(id);
    } else if (code) {
      query += "code = ?";
      params.push(code.toUpperCase().trim());
    } else if (mac) {
      query += "mac = ?";
      params.push(mac.toLowerCase().trim());
    }

    const [rows] = await pool.execute(query, params);
    if (rows.length === 0) {
      return reply.code(404).send({ success: false, message: "Voucher tidak ditemukan" });
    }

    const voucher = rows[0];

    // 1. Ubah status menjadi 'revoked' dan kadaluwarsa saat ini juga
    await pool.execute(
      "UPDATE vouchers SET status = 'revoked', expires_at = NOW() WHERE id = ?",
      [voucher.id]
    );

    // 2. Eksekusi pemutusan instan ke OpenNDS jika perangkat sudah login (memiliki MAC)
    if (voucher.mac && !voucher.mac.startsWith("ip-")) {
      queueNdsAction("DEAUTH", voucher.mac);
    }
    if (voucher.ip_address) {
      queueNdsAction("DEAUTH", voucher.ip_address);
    }

    fastify.log.info(
      `[Voucher Revoked & Kicked] Code: ${voucher.code}, MAC: ${voucher.mac}`
    );

    return reply.send({
      success: true,
      message: `Voucher ${voucher.code} berhasil dicabut dan koneksi perangkat langsung diputus.`,
      voucher: { id: voucher.id, code: voucher.code, status: "revoked" },
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Database error" });
  }
};

fastify.post("/api/revoke", handleRevoke);
fastify.post("/api/delete", handleRevoke);

// POST /api/admin/kick - Memutus sementara user yang sedang terhubung tanpa menghapus vouchernya
fastify.post("/api/admin/kick", async (request, reply) => {
  if (!isAdminAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const { mac, ip, id } = request.body || {};
  if (!mac && !ip && !id) {
    return reply.code(400).send({ error: "MAC, IP, atau ID diperlukan" });
  }

  try {
    // 1. Lepaskan ikatan MAC pada voucher agar auto-login tidak langsung menyambungkan ulang otomatis
    if (id) {
      await pool.execute("UPDATE vouchers SET mac = NULL WHERE id = ?", [id]);
    } else if (mac) {
      await pool.execute("UPDATE vouchers SET mac = NULL WHERE mac = ?", [mac.toLowerCase().trim()]);
    } else if (ip) {
      await pool.execute("UPDATE vouchers SET mac = NULL WHERE ip_address = ?", [ip.trim()]);
    }

    // 2. Putus koneksi instan di OpenNDS dan bersihkan conntrack
    if (mac && !mac.startsWith("ip-")) {
      queueNdsAction("DEAUTH", mac);
    }
    if (ip) {
      queueNdsAction("DEAUTH", ip);
    }

    return reply.send({
      success: true,
      message: `Koneksi perangkat ${mac || ip} berhasil diputus. Pelanggan harus memasukkan kode voucher untuk login kembali.`,
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Database error" });
  }
});

// GET /api/admin/sessions - Mengambil status pemantauan seluruh user & sesi aktif secara real-time
fastify.get("/api/admin/sessions", async (request, reply) => {
  if (!isAdminAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, code, customer_name, phone_number, duration_minutes, status, wa_status, wa_error, wa_sent_at, mac, ip_address, 
              created_at, expires_at, last_seen,
              TIMESTAMPDIFF(SECOND, NOW(), expires_at) as remaining_seconds
       FROM vouchers 
       ORDER BY id DESC`
    );

    const liveNds = getOpenNdsLiveStatus();
    const ndsClients = (liveNds && liveNds.clients) || {};
    const ndsTrusted = (liveNds && liveNds.trusted) || [];

    // Baca ARP table saat ini untuk mendeteksi perangkat yang online secara fisik di jaringan
    let activeArpIps = new Set();
    let activeArpMacs = new Set();
    try {
      if (fs.existsSync("/proc/net/arp")) {
        const lines = fs.readFileSync("/proc/net/arp", "utf8").split("\n");
        for (const l of lines) {
          const p = l.trim().split(/\s+/);
          if (p[0] && p[3] && p[3] !== "00:00:00:00:00:00") {
            activeArpIps.add(p[0]);
            activeArpMacs.add(p[3].toLowerCase());
          }
        }
      }
    } catch (e) {}

    let onlineNowCount = 0;
    let activeOngoingCount = 0;
    let availableUnusedCount = 0;
    let expiredOrRevokedCount = 0;

    const formattedVouchers = rows.map((v) => {
      const macLower = v.mac ? v.mac.toLowerCase() : null;
      const remSec = v.remaining_seconds != null ? Number(v.remaining_seconds) : null;

      // Status Aktif Berjalan
      const isOngoing = v.status === "used" && remSec != null && remSec > 0;
      if (isOngoing) activeOngoingCount++;
      else if (v.status === "active") availableUnusedCount++;
      else expiredOrRevokedCount++;

      // Deteksi Real-Time Online (Hanya jika benar-benar Authenticated di OpenNDS)
      let isOnline = false;
      let downloadedBytes = 0;
      let uploadedBytes = 0;

      if (macLower && ndsClients[macLower] && ndsClients[macLower].state === "Authenticated") {
        isOnline = true;
        downloadedBytes = parseInt(ndsClients[macLower].download_this_session || ndsClients[macLower].downloaded || 0);
        uploadedBytes = parseInt(ndsClients[macLower].upload_this_session || ndsClients[macLower].uploaded || 0);
      } else if (isOngoing && macLower && ndsTrusted.includes(macLower)) {
        isOnline = true;
      }

      if (isOnline) {
        onlineNowCount++;
      }

      return {
        id: v.id,
        code: v.code,
        customer_name: v.customer_name || "Tanpa Nama",
        phone_number: v.phone_number || "",
        duration_minutes: v.duration_minutes,
        status: v.status,
        wa_status: v.wa_status || "none",
        wa_error: v.wa_error || "",
        wa_sent_at: v.wa_sent_at || null,
        mac: v.mac,
        ip_address: v.ip_address,
        created_at: v.created_at,
        expires_at: v.expires_at,
        last_seen: v.last_seen,
        remaining_seconds: remSec,
        is_online: isOnline,
        is_ongoing: isOngoing,
        downloaded_bytes: downloadedBytes,
        uploaded_bytes: uploadedBytes,
      };
    });

    return reply.send({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total_vouchers: rows.length,
        online_now: onlineNowCount,
        active_ongoing: activeOngoingCount,
        available_unused: availableUnusedCount,
        expired_revoked: expiredOrRevokedCount,
      },
      vouchers: formattedVouchers,
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Database error" });
  }
});

// POST /api/login - Dipanggil oleh Halaman Splash Page saat klik Hubungkan
fastify.post("/api/login", async (request, reply) => {
  let { code, clientmac, clientip, authaction, tok, customer_name, phone_number } = request.body || {};
  const ip = clientip || request.ip;

  // Jika clientmac kosong dari browser, otomatis deteksi dari ARP table Linux
  if (!clientmac && ip) {
    clientmac = getMacFromArp(ip);
  }
  // Jika masih kosong, gunakan fallback IP
  if (!clientmac) {
    clientmac = `ip-${ip}`;
  }

  if (!code) {
    return reply.code(400).send({
      success: false,
      message: "Kode voucher diperlukan",
    });
  }

  try {
    const cleanCode = code.toUpperCase().trim();
    const cleanMac = clientmac.toLowerCase().trim();

    const [rows] = await pool.execute(
      'SELECT *, TIMESTAMPDIFF(SECOND, NOW(), expires_at) as rem_sec FROM vouchers WHERE code = ?',
      [cleanCode]
    );

    if (rows.length === 0) {
      return reply.code(401).send({
        success: false,
        message: "Kode voucher tidak ditemukan.",
      });
    }

    const voucher = rows[0];

    if (voucher.status === "revoked") {
      return reply.code(403).send({
        success: false,
        message: "Voucher ini telah dicabut / diblokir oleh admin.",
      });
    }

    if (voucher.status === "expired" || (voucher.status === "used" && voucher.rem_sec <= 0)) {
      await pool.execute("UPDATE vouchers SET status = 'expired' WHERE id = ?", [voucher.id]);
      return reply.code(403).send({
        success: false,
        message: "Masa aktif voucher ini telah habis (kedaluwarsa).",
      });
    }

    // Kasus 1: Voucher baru pertama kali dipakai
    if (voucher.status === "active") {
      // Simpan data nama & nomor WhatsApp (jika diisi pelanggan di splash page atau sudah ada sebelumnya)
      const finalName = (customer_name && customer_name.trim()) ? customer_name.trim() : voucher.customer_name;
      const normalizedPhone = normalizePhoneNumber(phone_number) || voucher.phone_number;

      await pool.execute(
        'UPDATE vouchers SET status = "used", mac = ?, ip_address = ?, customer_name = ?, phone_number = ?, last_seen = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
        [cleanMac, ip, finalName, normalizedPhone, voucher.duration_minutes, voucher.id]
      );

      if (!cleanMac.startsWith("ip-")) {
        queueNdsAction("AUTH", `${cleanMac} ${voucher.duration_minutes}`);
      }

      // Kirim WhatsApp secara asinkron di latar belakang HANYA 1 kali saat aktivasi pertama kali
      if (normalizedPhone) {
        setImmediate(() => {
          dispatchVoucherWhatsApp(voucher.id);
        });
      }

      let redirectUrl = "";
      if (authaction) {
        const baseUrl = authaction.split("?")[0];
        redirectUrl = `${baseUrl}?tok=${tok || ""}&redir=http://google.com`;
      } else {
        redirectUrl = `http://10.0.0.1:2050/opennds_auth/?tok=${tok || ""}&redir=http://google.com`;
      }

      return reply.send({
        success: true,
        message: "Login berhasil! Selamat menikmati internet.",
        redirect: redirectUrl,
      });
    }

    // Kasus 2: Voucher sedang digunakan (atau habis di-kick admin) dan masih punya sisa waktu
    if (voucher.status === "used" && voucher.rem_sec > 0) {
      // Keamanan: Cek apakah voucher sedang aktif di perangkat lain yang belum di-kick
      if (voucher.mac && voucher.mac !== cleanMac) {
        return reply.code(403).send({
          success: false,
          message: "Voucher ini sedang aktif digunakan di perangkat lain.",
        });
      }

      const remMinutes = Math.max(1, Math.ceil(voucher.rem_sec / 60));

      // Pasang kembali MAC perangkat (re-bind) & perbarui IP
      await pool.execute(
        'UPDATE vouchers SET mac = ?, ip_address = ?, last_seen = NOW() WHERE id = ?',
        [cleanMac, ip, voucher.id]
      );

      if (!cleanMac.startsWith("ip-")) {
        queueNdsAction("AUTH", `${cleanMac} ${remMinutes}`);
      }

      let redirectUrl = "";
      if (authaction) {
        const baseUrl = authaction.split("?")[0];
        redirectUrl = `${baseUrl}?tok=${tok || ""}&redir=http://google.com`;
      } else {
        redirectUrl = `http://10.0.0.1:2050/opennds_auth/?tok=${tok || ""}&redir=http://google.com`;
      }

      return reply.send({
        success: true,
        message: "Sesi berhasil dipulihkan! Sisa waktu Anda dilanjutkan.",
        redirect: redirectUrl,
      });
    }

    return reply.code(400).send({
      success: false,
      message: "Status voucher tidak valid.",
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Database error" });
  }
});

// POST /api/check_mac - Dipanggil otomatis saat Halaman Splash Page terbuka (Auto-Login)
fastify.post("/api/check_mac", async (request, reply) => {
  let { clientmac, clientip, authaction, tok } = request.body || {};
  const ip = clientip || request.ip;

  if (!clientmac && ip) {
    clientmac = getMacFromArp(ip);
  }

  if (!clientmac) {
    return reply.send({ active: false });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM vouchers WHERE mac = ? AND status = "used" AND expires_at > NOW()',
      [clientmac.toLowerCase()]
    );

    if (rows.length > 0) {
      // Update last seen & IP
      await pool.execute(
        "UPDATE vouchers SET ip_address = ?, last_seen = NOW() WHERE id = ?",
        [ip, rows[0].id]
      );
      // Sinkronkan auth ke OpenNDS jika belum aktif
      const [diffRows] = await pool.execute(
        "SELECT TIMESTAMPDIFF(MINUTE, NOW(), expires_at) as rem FROM vouchers WHERE id = ?",
        [rows[0].id]
      );
      const remMin = (diffRows[0] && diffRows[0].rem > 0) ? diffRows[0].rem : 60;
      if (!clientmac.startsWith("ip-")) {
        queueNdsAction("AUTH", `${clientmac.toLowerCase()} ${remMin}`);
      }

      const baseUrl = authaction ? authaction.split("?")[0] : "http://10.0.0.1:2050/opennds_auth/";
      const redirectUrl = `${baseUrl}?tok=${tok || ""}&clientip=${ip}`;
      return reply.send({ active: true, redirect: redirectUrl });
    }

    return reply.send({ active: false });
  } catch (err) {
    fastify.log.error(err);
    return reply.send({ active: false });
  }
});

// GET /api/binauth - Dipanggil oleh Script Binauth OpenNDS di sistem operasi Rock Pi
// DILENGKAPI DENGAN MITIGASI RANDOM MAC ADDRESS (AUTO-BIND)
fastify.get("/api/binauth", async (request, reply) => {
  const { mac } = request.query;

  if (!mac) {
    return reply.type("text/plain").send("0");
  }

  const clientMac = mac.toLowerCase();

  try {
    // 1. Cek apakah MAC ini sudah punya voucher aktif
    const [rows] = await pool.execute(
      'SELECT TIMESTAMPDIFF(MINUTE, NOW(), expires_at) as remaining_minutes FROM vouchers WHERE mac = ? AND status = "used" AND expires_at > NOW()',
      [clientMac]
    );

    if (rows.length > 0) {
      const remaining = rows[0].remaining_minutes;
      if (remaining > 0) {
        return reply.type("text/plain").send(`1 ${remaining} 5000 5000`);
      }
    }

    // 2. MITIGASI RANDOM MAC: Jika MAC berbeda karena fitur Private Wi-Fi acak di HP,
    // cari voucher yang baru saja berhasil login dalam 5 menit terakhir, lalu auto-bind ke MAC ini!
    const [recentRows] = await pool.execute(
      'SELECT id, TIMESTAMPDIFF(MINUTE, NOW(), expires_at) as remaining_minutes FROM vouchers WHERE status = "used" AND expires_at > NOW() ORDER BY id DESC LIMIT 1'
    );

    if (recentRows.length > 0 && recentRows[0].remaining_minutes > 0) {
      await pool.execute("UPDATE vouchers SET mac = ? WHERE id = ?", [clientMac, recentRows[0].id]);
      fastify.log.info(`[Auto-Bind Random MAC] Voucher ID ${recentRows[0].id} otomatis diikat ke MAC ${clientMac}`);
      return reply.type("text/plain").send(`1 ${recentRows[0].remaining_minutes} 5000 5000`);
    }

    return reply.type("text/plain").send("0"); // Akses Ditolak
  } catch (err) {
    fastify.log.error(err);
    return reply.type("text/plain").send("0");
  }
});

// POST /api/reset_mac - Untuk dipanggil jika user ganti HP / reset MAC
fastify.post("/api/reset_mac", async (request, reply) => {
  if (!isAdminAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const { code } = request.body || {};
  try {
    await pool.execute(
      'UPDATE vouchers SET mac = NULL, status = "active", expires_at = NULL WHERE code = ?',
      [code]
    );
    return reply.send({ success: true, message: "MAC Reset Successfully" });
  } catch (err) {
    return reply.code(500).send({ error: "Database error" });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    console.log(`Server listening on port 3000`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
