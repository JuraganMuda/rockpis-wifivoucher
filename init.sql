CREATE TABLE IF NOT EXISTS vouchers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(6) NOT NULL UNIQUE,
    duration_minutes INT NOT NULL DEFAULT 0,
    status ENUM('active', 'used', 'expired') NOT NULL DEFAULT 'active',
    mac VARCHAR(17) DEFAULT NULL,
    expires_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
