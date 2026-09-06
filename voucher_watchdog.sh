#!/bin/bash
# ==========================================================
# RTNA WiFi Voucher - 24/7 Auto-Healing Watchdog
# Menjamin kelancaran internet & auto-login pelanggan
# ==========================================================

nds_run() {
    local cmd="$1"
    for i in 1 2 3 4 5; do
        out=$(eval "$cmd" 2>&1)
        if echo "$out" | grep -qi "busy"; then
            sleep 0.2
        else
            break
        fi
    done
}

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

    # 6. Pembersihan Trusted MAC:
    # JANGAN PERNAH meninggalkan MAC voucher pelanggan dalam daftar Trusted!
    # Karena openNDS tidak dapat melakukan deauth pada Trusted MAC dan akan merusak alur captive portal.
    TRUSTED_NOW=$(ndsctl status 2>/dev/null | sed -n '/Trusted MAC addresses:/,/====/p' | grep -E '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' | tr 'A-Z' 'a-z')
    for m in $TRUSTED_NOW; do
        nds_run "ndsctl untrust $m"
    done

    # 7. Otomatis Deauth & Untrust SEMUA voucher yang telah kedaluwarsa atau dicabut
    EXPIRED_MACS=$(docker exec mariadb_nds mysql -u radius -pradius_password -N -e "SELECT DISTINCT LOWER(mac) FROM radius_db.vouchers WHERE (status='expired' OR status='revoked' OR (status='used' AND expires_at <= NOW())) AND mac IS NOT NULL AND mac NOT LIKE 'ip-%';" 2>/dev/null)
    for m in $EXPIRED_MACS; do
        nds_run "ndsctl deauth $m"
        nds_run "ndsctl untrust $m"
        if command -v conntrack >/dev/null 2>&1; then
            conntrack -D -s "$m" >/dev/null 2>&1 || true
            conntrack -D -d "$m" >/dev/null 2>&1 || true
        fi
    done

    # Update status voucher kedaluwarsa di database jika durasinya habis
    docker exec mariadb_nds mysql -u radius -pradius_password -e "UPDATE radius_db.vouchers SET status='expired' WHERE status='used' AND expires_at <= NOW();" >/dev/null 2>&1

    # 7b. Otomatis Pulihkan (Auto-Restore) Sesi Klien yang Masih Aktif di Database
    # Jika Docker / OpenNDS restart atau mati lampu, klien tidak perlu memasukkan ulang voucher!
    AUTH_NOW=$(ndsctl json 2>/dev/null | grep -oE '"[0-9a-fA-F:]{17}":\{[^}]*"state":"Authenticated"' | grep -oE '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' | tr 'A-Z' 'a-z')
    if [ -z "$AUTH_NOW" ]; then
        AUTH_NOW=$(ndsctl status 2>/dev/null | grep -B 5 -A 10 "State: Authenticated" | grep -oE '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' | tr 'A-Z' 'a-z')
    fi

    ACTIVE_VOUCHERS=$(docker exec mariadb_nds mysql -u radius -pradius_password -N -e "SELECT LOWER(mac), CEIL(TIMESTAMPDIFF(SECOND, NOW(), expires_at)/60) FROM radius_db.vouchers WHERE status='used' AND expires_at > NOW() AND mac IS NOT NULL AND mac NOT LIKE 'ip-%';" 2>/dev/null)
    if [ -n "$ACTIVE_VOUCHERS" ]; then
        echo "$ACTIVE_VOUCHERS" | while read -r v_mac v_rem; do
            if [ -n "$v_mac" ] && [ -n "$v_rem" ] && [ "$v_rem" -gt 0 ]; then
                if ! echo "$AUTH_NOW" | grep -qi "$v_mac"; then
                    nds_run "ndsctl auth $v_mac $v_rem"
                fi
            fi
        done
    fi

    # 8. Dump Status Live OpenNDS untuk dibaca oleh Live Monitoring Dashboard API
    if command -v ndsctl >/dev/null 2>&1; then
        ndsctl json 2>/dev/null > /tmp/nds_live_status.json.tmp && mv /tmp/nds_live_status.json.tmp /tmp/nds_live_status.json 2>/dev/null || true
    fi
}

# Saluran Perintah Cepat Antrean Aksi (< 1 detik)
ACTION_QUEUE="/tmp/nds_action_queue"
touch "$ACTION_QUEUE" 2>/dev/null || true
chmod 666 "$ACTION_QUEUE" 2>/dev/null || true

process_queue() {
    if [ -s "$ACTION_QUEUE" ]; then
        while IFS= read -r line || [ -n "$line" ]; do
            cmd=$(echo "$line" | awk '{print $1}')
            target=$(echo "$line" | awk '{print $2}' | tr 'A-Z' 'a-z')
            extra=$(echo "$line" | awk '{print $3}')
            if [ -n "$target" ]; then
                if [ "$cmd" = "REVOKE" ] || [ "$cmd" = "KICK" ] || [ "$cmd" = "DEAUTH" ]; then
                    nds_run "ndsctl deauth $target"
                    nds_run "ndsctl untrust $target"
                    if command -v conntrack >/dev/null 2>&1; then
                        conntrack -D -s "$target" >/dev/null 2>&1 || true
                        conntrack -D -d "$target" >/dev/null 2>&1 || true
                    fi
                elif [ "$cmd" = "AUTH" ]; then
                    duration=${extra:-1440}
                    nds_run "ndsctl auth $target $duration"
                elif [ "$cmd" = "UNTRUST" ]; then
                    nds_run "ndsctl untrust $target"
                elif [ "$cmd" = "TRUST" ]; then
                    nds_run "ndsctl trust $target"
                fi
            fi
        done < "$ACTION_QUEUE"
        > "$ACTION_QUEUE"
    fi
}

# Tunggu sejenak saat booting awal
sleep 3
heal

# Loop pengawasan: Cek antrean aksi instan setiap 1 detik, audit penuh berkala setiap 15 detik
counter=0
while true; do
    process_queue
    sleep 1
    counter=$((counter + 1))
    if [ $counter -ge 15 ]; then
        heal
        counter=0
    fi
done
