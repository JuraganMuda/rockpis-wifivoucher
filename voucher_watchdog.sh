#!/bin/bash
# ==========================================================
# RTNA WiFi Voucher - 24/7 Auto-Healing Watchdog
# Menjamin kelancaran internet & auto-login pelanggan
# ==========================================================

heal() {
    # 1. Pastikan end0 memiliki IP statis 192.168.0.151 dan route default
    if ! ip addr show dev end0 2>/dev/null | grep -q "192.168.0.151"; then
        ip addr add 192.168.0.151/24 dev end0 2>/dev/null || true
        ip link set end0 up 2>/dev/null || true
    fi
    if ! ip route | grep -q "default via 192.168.0.1"; then
        ip route replace default via 192.168.0.1 dev end0 2>/dev/null || true
    fi
    ip addr del 192.168.100.2/24 dev end0 2>/dev/null || true
    ip addr del 10.0.0.1/24 dev end0 2>/dev/null || true

    # 2. Pastikan interface USB LAN (enxdc045ac61522) memiliki IP 10.0.0.1
    LAN_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^enx|^eth' | grep -v 'end0' | head -n 1 | tr -d '@NONE')
    if [ -n "$LAN_IFACE" ]; then
        if ! ip addr show dev "$LAN_IFACE" 2>/dev/null | grep -q "10.0.0.1/24"; then
            ip addr flush dev "$LAN_IFACE" 2>/dev/null || true
            ip addr add 10.0.0.1/24 dev "$LAN_IFACE" 2>/dev/null || true
            ip link set "$LAN_IFACE" up 2>/dev/null || true
        fi
    fi

    # 3. IP Forwarding & NAT Masquerade
    if [ "$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)" != "1" ]; then
        sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1
    fi
    if ! iptables -t nat -C POSTROUTING -o end0 -j MASQUERADE 2>/dev/null; then
        iptables -t nat -A POSTROUTING -o end0 -j MASQUERADE 2>/dev/null || true
    fi

    # 4. Service dnsmasq & opennds
    if ! systemctl is-active --quiet dnsmasq; then
        systemctl restart dnsmasq
    fi
    if ! systemctl is-active --quiet opennds; then
        systemctl restart opennds
    fi

    # 5. Docker Containers
    for c in node_api mariadb_nds cloudflared_tunnel; do
        if [ "$(docker inspect -f '{{.State.Running}}' $c 2>/dev/null)" != "true" ]; then
            docker start $c 2>/dev/null || true
        fi
    done

    # 6. Auto-Trust MAC Pelanggan (Agar tidak perlu ketik voucher berulang kali!)
    # Ambil list MAC yang saat ini sudah trusted di OpenNDS
    TRUSTED_NOW=$(ndsctl status 2>/dev/null | sed -n '/Trusted MAC addresses:/,/====/p' | grep -E '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' | tr 'A-Z' 'a-z')

    # Ambil list MAC yang masih punya voucher aktif dari MariaDB
    ACTIVE_MACS=$(docker exec mariadb_nds mysql -u radius -pradius_password -N -e "SELECT DISTINCT LOWER(mac) FROM radius_db.vouchers WHERE status='used' AND expires_at > NOW() AND mac IS NOT NULL AND mac NOT LIKE 'ip-%';" 2>/dev/null)

    # Otomatis Trust setiap pelanggan yang vouchernya masih aktif
    for m in $ACTIVE_MACS; do
        if ! echo "$TRUSTED_NOW" | grep -q "$m"; then
            ndsctl trust "$m" >/dev/null 2>&1
        fi
    done

    # Otomatis Untrust pelanggan yang durasinya sudah habis (kedaluwarsa)
    EXPIRED_MACS=$(docker exec mariadb_nds mysql -u radius -pradius_password -N -e "SELECT DISTINCT LOWER(mac) FROM radius_db.vouchers WHERE status='used' AND expires_at <= NOW() AND mac IS NOT NULL;" 2>/dev/null)
    for m in $EXPIRED_MACS; do
        if ! echo "$ACTIVE_MACS" | grep -q "$m"; then
            ndsctl untrust "$m" >/dev/null 2>&1
        fi
    done
    # Update status voucher kedaluwarsa di database
    docker exec mariadb_nds mysql -u radius -pradius_password -e "UPDATE radius_db.vouchers SET status='expired' WHERE status='used' AND expires_at <= NOW();" >/dev/null 2>&1
}

# Tunggu sejenak saat booting awal
sleep 3
heal
while true; do
    sleep 15
    heal
done
