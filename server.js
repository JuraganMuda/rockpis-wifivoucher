const path = require("path");
const fastify = require("fastify")({ logger: true });
const mysql = require("mysql2/promise");

// Environment variables
const API_KEY = process.env.API_KEY || "rahasia-appsheet-123";
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

// Initialize DB connection
fastify.addHook("onReady", async () => {
  pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    timezone: "+00:00", // Pastikan timezone konsisten
  });
});

// Utility to generate random code
function generateVoucherCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// POST /api/generate - Dipanggil oleh AppSheet
fastify.post("/api/generate", async (request, reply) => {
  const apiKey = request.headers["x-api-key"];
  if (apiKey && apiKey !== API_KEY) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const body = request.body || {};
  let { duration_minutes, code: providedCode, Status, Assignee, Title } = body;

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

  // 2. Ambil kode voucher (dari Assignee jika dibuat AppSheet, atau generate baru)
  const code = (providedCode || Assignee || generateVoucherCode()).toUpperCase().trim();

  try {
    const [result] = await pool.execute(
      "INSERT INTO vouchers (code, duration_minutes, status) VALUES (?, ?, 'active') ON DUPLICATE KEY UPDATE duration_minutes = VALUES(duration_minutes), status = 'active'",
      [code, duration_minutes],
    );

    // 3. PENTING: Kembalikan key 'code' di level root object agar AppSheet membacanya sukses
    return reply.send({
      success: true,
      code: code,
      duration_minutes: duration_minutes,
      voucher: { id: result.insertId, code, duration_minutes },
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Database error" });
  }
});

// Helper untuk membaca MAC Address dari ARP table Linux (/proc/net/arp)
const fs = require("fs");
function getMacFromArp(ip) {
  try {
    const arpData = fs.readFileSync("/proc/net/arp", "utf8");
    const lines = arpData.split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === ip && parts[3] && parts[3] !== "00:00:00:00:00:00") {
        return parts[3].toLowerCase();
      }
    }
  } catch (err) {
    fastify.log.error(err);
  }
  return null;
}

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
    return reply
      .code(400)
      .send({
        success: false,
        message: "Kode voucher diperlukan",
      });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM vouchers WHERE code = ? AND status = "active"',
      [code.toUpperCase().trim()],
    );

    if (rows.length === 0) {
      return reply
        .code(401)
        .send({
          success: false,
          message: "Voucher tidak valid atau sudah digunakan",
        });
    }

    const voucher = rows[0];

    // Aktifkan voucher: Set MAC, ubah status, set expires_at
    await pool.execute(
      'UPDATE vouchers SET status = "used", mac = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
      [clientmac.toLowerCase(), voucher.duration_minutes, voucher.id],
    );

    // Buat URL Redirect ke OpenNDS yang bersih dengan landing page (redir)
    let redirectUrl = "";
    if (authaction) {
      const baseUrl = authaction.split("?")[0];
      redirectUrl = `${baseUrl}?tok=${tok || ''}&redir=http://google.com`;
    } else {
      redirectUrl = `http://10.0.0.1:2050/opennds_auth/?tok=${tok || ''}&redir=http://google.com`;
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
      [clientmac.toLowerCase()],
    );

    if (rows.length > 0) {
      const baseUrl = authaction ? authaction.split("?")[0] : "http://10.0.0.1:2050/opennds_auth/";
      const redirectUrl = `${baseUrl}?tok=${tok || ''}&clientip=${ip}`;
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
      [clientMac],
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
      await pool.execute('UPDATE vouchers SET mac = ? WHERE id = ?', [clientMac, recentRows[0].id]);
      fastify.log.info(`[Auto-Bind Random MAC] Voucher ID ${recentRows[0].id} otomatis diikat ke MAC ${clientMac}`);
      return reply.type("text/plain").send(`1 ${recentRows[0].remaining_minutes} 5000 5000`);
    }

    return reply.type("text/plain").send("0"); // Akses Ditolak
  } catch (err) {
    fastify.log.error(err);
    return reply.type("text/plain").send("0");
  }
});

// POST /api/reset_mac - (Opsional) Untuk dipanggil dari AppSheet jika user salah pencet Forget Network
fastify.post("/api/reset_mac", async (request, reply) => {
  const apiKey = request.headers["x-api-key"];
  if (apiKey !== API_KEY) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const { code } = request.body || {};
  try {
    await pool.execute(
      'UPDATE vouchers SET mac = NULL, status = "active", expires_at = NULL WHERE code = ?',
      [code],
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
