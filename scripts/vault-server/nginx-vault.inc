# Reverse-proxy Steam Account Manager TS3 vault. Include inside each CDN HTTPS server.
location ^~ /vault/ {
    proxy_pass http://127.0.0.1:8788/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade "";
    proxy_set_header Connection "";
    client_max_body_size 2m;
    access_log off;
    add_header Cache-Control "no-store" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, PUT, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, X-Ts3-Id" always;
    add_header X-Content-Type-Options nosniff always;
    if ($request_method = OPTIONS) {
        return 204;
    }
}
