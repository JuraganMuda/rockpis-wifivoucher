CREATE TABLE IF NOT EXISTS vouchers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(10) NOT NULL UNIQUE,
    customer_name VARCHAR(100) DEFAULT NULL,
    phone_number VARCHAR(30) DEFAULT NULL,
    duration_minutes INT NOT NULL DEFAULT 0,
    status ENUM('active', 'used', 'expired', 'revoked') NOT NULL DEFAULT 'active',
    wa_status ENUM('none', 'pending', 'sent', 'failed') NOT NULL DEFAULT 'none',
    wa_error VARCHAR(255) DEFAULT NULL,
    wa_sent_at DATETIME DEFAULT NULL,
    mac VARCHAR(17) DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    expires_at DATETIME DEFAULT NULL,
    last_seen DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_mac (mac),
    INDEX idx_status (status),
    INDEX idx_phone (phone_number)
);

CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value TEXT NOT NULL
);

INSERT IGNORE INTO settings (setting_key, setting_value) VALUES
('business_name', 'RTNA Wi-Fi'),
('wifi_ssid', 'RTNA WiFi Voucher'),
('login_portal_url', 'http://10.0.0.1:3000'),
('fonnte_token', ''),
('wa_template', 'Halo *{nama}*, terima kasih telah menggunakan layanan *{nama_usaha}*!\n\nBerikut adalah rincian voucher internet Anda:\n🎫 Kode Voucher: *{kode}*\n📦 Paket: *{paket}*\n⏳ Masa Aktif: Berlaku hingga *{berlaku_hingga}*\n\n💡 *PANDUAN JIKA KONEKSI TERPUTUS / GANTI HP / LUPA JARINGAN:*\n1. Sambungkan kembali HP Anda ke Wi-Fi: *{nama_wifi}*\n2. Buka browser dan akses portal: {portal_url}\n3. Masukkan kembali Kode Voucher Anda (*{kode}*) lalu klik "Hubungkan".\n\nSimpan pesan ini agar nomor voucher Anda tidak hilang. Selamat menikmati internet!');
