const fs = require("fs");
const path = require("path");
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
    const line = `${action.toUpperCase()} ${target.toLowerCase()}\n`;
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
      return JSON.parse(raw);
    }
  } catch (err) {
    // Abaikan jika berkas belum terbentuk
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

  let { duration_minutes, code: providedCode, Status, Assignee, Title, customer_name } = body;

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

  // 2. Ambil nama pelanggan dari AppSheet: Title di AppSheet adalah Nama Pelanggan
  const custName = (customer_name || Title || "").trim() || null;

  // 3. Ambil kode voucher (dari providedCode jika dibuat AppSheet, atau generate baru)
  const code = (providedCode || generateVoucherCode()).toUpperCase().trim();

  try {
    const [result] = await pool.execute(
      "INSERT INTO vouchers (code, customer_name, duration_minutes, status) VALUES (?, ?, ?, 'active') ON DUPLICATE KEY UPDATE customer_name = VALUES(customer_name), duration_minutes = VALUES(duration_minutes), status = 'active'",
      [code, custName, duration_minutes]
    );

    return reply.send({
      success: true,
      code: code,
      customer_name: custName,
      duration_minutes: duration_minutes,
      voucher: { id: result.insertId, code, customer_name: custName, duration_minutes },
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
      queueNdsAction("REVOKE", voucher.mac);
    }
    if (voucher.ip_address) {
      queueNdsAction("KICK", voucher.ip_address);
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

  const { mac, ip } = request.body || {};
  if (!mac && !ip) {
    return reply.code(400).send({ error: "MAC atau IP diperlukan" });
  }

  if (mac && !mac.startsWith("ip-")) {
    queueNdsAction("KICK", mac);
  }
  if (ip) {
    queueNdsAction("KICK", ip);
  }

  return reply.send({
    success: true,
    message: `Koneksi perangkat ${mac || ip} berhasil diputus.`,
  });
});

// GET /api/admin/sessions - Mengambil status pemantauan seluruh user & sesi aktif secara real-time
fastify.get("/api/admin/sessions", async (request, reply) => {
  if (!isAdminAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, code, customer_name, duration_minutes, status, mac, ip_address, 
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

      // Deteksi Real-Time Online
      let isOnline = false;
      let downloadedBytes = 0;
      let uploadedBytes = 0;

      if (macLower && ndsClients[macLower]) {
        isOnline = true;
        downloadedBytes = ndsClients[macLower].downloaded || 0;
        uploadedBytes = ndsClients[macLower].uploaded || 0;
      } else if (
        isOngoing &&
        macLower &&
        (activeArpMacs.has(macLower) || ndsTrusted.includes(macLower))
      ) {
        isOnline = true;
      } else if (isOngoing && v.ip_address && activeArpIps.has(v.ip_address)) {
        isOnline = true;
      }

      if (isOnline) {
        onlineNowCount++;
      }

      return {
        id: v.id,
        code: v.code,
        customer_name: v.customer_name || "Tanpa Nama",
        duration_minutes: v.duration_minutes,
        status: v.status,
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
  let { code, clientmac, clientip, authaction, tok } = request.body || {};
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
    const [rows] = await pool.execute(
      'SELECT * FROM vouchers WHERE code = ? AND status = "active"',
      [code.toUpperCase().trim()]
    );

    if (rows.length === 0) {
      return reply.code(401).send({
        success: false,
        message: "Voucher tidak valid, sudah dipakai, atau telah dicabut",
      });
    }

    const voucher = rows[0];

    // Aktifkan voucher: Set MAC, IP, ubah status, catat waktu mulai & expired
    await pool.execute(
      'UPDATE vouchers SET status = "used", mac = ?, ip_address = ?, last_seen = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
      [clientmac.toLowerCase(), ip, voucher.duration_minutes, voucher.id]
    );

    // Kirim sinyal Trust instan ke OpenNDS
    if (!clientmac.startsWith("ip-")) {
      queueNdsAction("TRUST", clientmac.toLowerCase());
    }

    // Buat URL Redirect ke OpenNDS yang bersih dengan landing page (redir)
    let redirectUrl = "";
    if (authaction) {
      const baseUrl = authaction.split("?")[0];
      redirectUrl = `${baseUrl}?tok=${tok || ""}&redir=http://google.com`;
    } else {
      redirectUrl = `http://10.0.0.1:2050/opennds_auth/?tok=${tok || ""}&redir=http://google.com`;
    }

    return reply.send({
      success: true,
      message: "Login berhasil",
      redirect: redirectUrl,
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
