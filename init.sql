CREATE TABLE IF NOT EXISTS vouchers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(10) NOT NULL UNIQUE,
    customer_name VARCHAR(100) DEFAULT NULL,
    duration_minutes INT NOT NULL DEFAULT 0,
    status ENUM('active', 'used', 'expired', 'revoked') NOT NULL DEFAULT 'active',
    mac VARCHAR(17) DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    expires_at DATETIME DEFAULT NULL,
    last_seen DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_mac (mac),
    INDEX idx_status (status)
);

