#!/bin/bash
# Custom Binauth for OpenNDS with Node.js Fastify Integration

if [ "$action" = "auth_client" ]; then
    RESPONSE=$(curl -s --max-time 3 "http://127.0.0.1:3000/api/binauth?mac=$clientmac" 2>/dev/null)
    if [ -n "$RESPONSE" ] && [ "$RESPONSE" != "0" ]; then
        auth_status=$(echo "$RESPONSE" | awk '{print $1}')
        rem_min=$(echo "$RESPONSE" | awk '{print $2}')
        u_rate=$(echo "$RESPONSE" | awk '{print $3}')
        d_rate=$(echo "$RESPONSE" | awk '{print $4}')

        if [ "$auth_status" = "1" ] && [ -n "$rem_min" ] && [ "$rem_min" -gt 0 ]; then
            session_length=$rem_min
            upload_rate=${u_rate:-0}
            download_rate=${d_rate:-0}
            exitlevel=0
        else
            exitlevel=1
        fi
    else
        exitlevel=1
    fi
fi
