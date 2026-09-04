# RTNA Wi-Fi Voucher System (Captive Portal SBC)

[![Hardware](<https://img.shields.io/badge/Hardware-Rock%20Pi%20S%20(512MB)-blueviolet.svg>)](#)
[![Stack](https://img.shields.io/badge/Stack-Fastify%20%7C%20MariaDB%20%7C%20OpenNDS-indigo.svg)](#)
[![Ingress](https://img.shields.io/badge/Tunnel-Cloudflare%20Zero%20Trust-orange.svg)](#)
[![Resilience](https://img.shields.io/badge/Resilience-PLN--Proof%20Auto--Healing-emerald.svg)](#)
[![Edition](https://img.shields.io/badge/Version-2.0%20Final-blue.svg)](#)

Sistem Captive Portal Wi-Fi Voucher komersial mandiri berbasis Single Board Computer (**Rock Pi S V1.3 - RAM 512MB**) dengan efisiensi memori tinggi, arsitektur _API-First_ (terintegrasi dengan **Google AppSheet** melalui **Cloudflare Tunnel**), fitur kenyamanan pelanggan **Zero-Touch MAC Auto-Trust**, serta sistem pengawas mandiri **Auto-Healing Watchdog 24/7** yang tahan pemadaman listrik (PLN-Proof).

---

## 📑 Dokumentasi Lengkap

Panduan arsitektur komprehensif, manual konfigurasi OS, skema database, dan buku panduan teknis tersedia di:

- **Markdown Manual:** [`MASTER_SYSTEM_DOCUMENTATION.md`](./MASTER_SYSTEM_DOCUMENTATION.md)
- **Executive PDF Document:** [`MASTER_SYSTEM_DOCUMENTATION_RTNA_WIFI.pdf`](./MASTER_SYSTEM_DOCUMENTATION_RTNA_WIFI.pdf)

---

## 🏗️ Struktur Repositori

```text
rockpis-wifivoucher/
├── public/
│   ├── index.html               # Splash page captive portal (desain modern & responsive)
│   └── admin.html               # Live Active User Monitor & Control Center (Mobile-First)
├── .gitignore                   # Aturan pengabaian file sementara & rahasia
├── docker-compose.yml           # Orkestrasi kontainer (node_api, mariadb_nds, cloudflared)
├── Dockerfile                   # Spesifikasi container Node.js 20 Alpine Fastify
├── init.sql                     # Skema inisialisasi tabel database vouchers (mendukung customer_name & IP)
├── package.json                 # Dependensi Node.js (Fastify, Fastify-Static, MySQL2)
├── server.js                    # Server Fastify: Webhook API, Live Monitor API, Revoke, dan OpenNDS
├── voucher_watchdog.sh          # Daemon pengawas 24/7 (PLN-Proof, NAT, instant queue, sync trusted MAC)
├── build_pdf.js                 # Generator cetak PDF dokumentasi A4
├── MASTER_SYSTEM_DOCUMENTATION.md # Buku panduan teknis & arsitektur sistem
└── README.md                    # Ringkasan proyek GitHub
```

---

## 🚀 Panduan Ringkas Menjalankan (Quick Start)

### 1. Prasyarat Sistem (System Prerequisites)

Sistem ini dioptimalkan secara presisi untuk efisiensi memori RAM 512MB dan penamaan antarmuka kernel Linux modern. **Sangat diwajibkan untuk mengunduh dan melakukan flash sistem operasi Armbian versi yang telah teruji berikut sebelum memulai:**

#### A. Spesifikasi Hardware & Sistem Operasi
- **Perangkat Keras:** Rock Pi S V1.3 (SoC RK3308, RAM 512MB)
- **Sistem Operasi:** [Armbian v26.8.1 (Ubuntu 26.04 CLI / Minimal)](https://www.armbian.com/rockpi-s/)
- **Versi Kernel:** `Linux 6.18.43-current-rockchip64` (aarch64)
- **Media Penyimpanan:** Kartu MicroSD minimal 16GB (Direkomendasikan Class 10 / A1)

> [!CAUTION]
> **PENTING - HANYA GUNAKAN VARIAN CLI (TANPA DESKTOP):**  
> Mengingat kapasitas RAM Rock Pi S hanya 512MB, **DILARANG** menggunakan Armbian varian Desktop (GUI). Gunakan hanya varian **CLI / Minimal / Server** agar konsumsi RAM idle tetap berada di bawah ~80MB.

#### B. Persiapan Awal OS (Swapfile 1GB)
Sebelum menjalankan Docker, buat swapfile 1GB di dalam Rock Pi S untuk mencegah *Out-of-Memory (OOM)* saat instalasi kontainer:
```bash
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

#### C. Topologi & Alokasi Jaringan
- **Port WAN (`end0`):** IP Statis `192.168.0.151/24` (Gateway Modem Advan: `192.168.0.1`)
- **Port LAN Hotspot (Dongle USB Ethernet):** IP Statis `10.0.0.1/24`  
  *(Skrip watchdog telah dirancang cerdas untuk otomatis mendeteksi nama interface USB LAN Anda, baik `enx*` maupun `eth1`).*

#### D. Paket Dependensi Wajib OS
Jalankan perintah berikut di terminal Rock Pi S untuk memasang paket yang dibutuhkan:
```bash
apt update && apt install -y docker.io docker-compose-plugin opennds dnsmasq iptables-persistent netfilter-persistent
```

### 2. Menjalankan Tumpukan Kontainer Docker

```bash
# Clone repositori ke direktori kerja
git clone https://github.com/<username>/rockpis-wifivoucher.git /root/rockpis-wifivoucher
cd /root/rockpis-wifivoucher

# Jalankan seluruh service (Fastify, MariaDB, Cloudflare Tunnel)
docker compose up -d

# Periksa status kontainer
docker compose ps
```

> **Catatan Portabilitas Nama Folder:**  
> Proyek dan volume database telah dikunci secara eksplisit (`name: rockpis-wifivoucher` dan volume `rockpis_voucher_db_data`). Anda bebas mengubah nama folder proyek kapan saja tanpa khawatir data voucher hilang atau volume database ter-reset.


### 3. Mengaktifkan Watchdog Otonom 24/7 (PLN-Proof)

```bash
# Salin skrip pengawas ke direktori binary sistem
cp /root/rockpis-wifivoucher/voucher_watchdog.sh /usr/local/bin/voucher_watchdog.sh
chmod +x /usr/local/bin/voucher_watchdog.sh

# Daftarkan ke systemd agar otomatis aktif saat boot
systemctl enable --now voucher-watchdog.service
```

---

## 🛡️ Lisensi & Hak Cipta

Sistem dikembangkan untuk jaringan mandiri **RTNA Wi-Fi Hotspot**. Bebas digunakan dan disesuaikan untuk implementasi jaringan mikro / RT-RW Net berbasis perangkat hemat daya.

---

> *"Salam Hangat dari Bintaro - Indonesia"*  
> **[@JuraganMuda](https://www.instagram.com/juraganmuda/)** | IG

