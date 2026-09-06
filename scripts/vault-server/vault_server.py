#!/usr/bin/env python3
"""Steam Account Manager 外出存档服务：按 TeamSpeak Unique ID 存取资料包。"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = os.environ.get("SAM_VAULT_HOST", "127.0.0.1")
PORT = int(os.environ.get("SAM_VAULT_PORT", "8788"))
DATA_DIR = Path(os.environ.get("SAM_VAULT_DIR", "/var/lib/sam-vault"))
MAX_BYTES = 1_500_000
ID_RE = re.compile(r"^[A-Za-z0-9+/=._-]{8,80}$")
RATE_LIMIT = 40
RATE_WINDOW = 60.0
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ts3-Id",
    "Access-Control-Max-Age": "86400",
}

_lock = threading.Lock()
_hits: dict[str, list[float]] = {}


def archive_path(vault_id: str) -> Path:
    digest = hashlib.sha256(vault_id.encode("utf-8")).hexdigest()
    return DATA_DIR / f"{digest}.json"


def allowed(ip: str) -> bool:
    now = time.time()
    with _lock:
        stamps = [stamp for stamp in _hits.get(ip, []) if now - stamp < RATE_WINDOW]
        if len(stamps) >= RATE_LIMIT:
            _hits[ip] = stamps
            return False
        stamps.append(now)
        _hits[ip] = stamps
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = "sam-vault/1"

    def log_message(self, format: str, *args: object) -> None:
        message = format % args
        lowered = message.lower()
        if "apikey" in lowered or "password" in lowered:
            return
        super().log_message("%s", message.split("?")[0])

    def _client_ip(self) -> str:
        forwarded = self.headers.get("X-Real-IP") or self.headers.get("X-Forwarded-For") or ""
        first = forwarded.split(",")[0].strip()
        return first or self.client_address[0]

    def _send(self, code: int, payload: dict, extra_headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in CORS.items():
            self.send_header(key, value)
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _vault_id(self) -> str | None:
        parsed = urlparse(self.path)
        if parsed.path.rstrip("/") != "/v1/archive":
            return None
        vault_id = (parse_qs(parsed.query, keep_blank_values=False).get("id") or [""])[0].strip()
        if not vault_id:
            vault_id = (self.headers.get("X-Ts3-Id") or "").strip()
        if not vault_id or not ID_RE.match(vault_id) or ".." in vault_id:
            return None
        return vault_id

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        for key, value in CORS.items():
            self.send_header(key, value)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path.rstrip("/") == "/healthz":
            self._send(200, {"ok": True})
            return
        if not allowed(self._client_ip()):
            self._send(429, {"error": "请求过于频繁"})
            return
        vault_id = self._vault_id()
        if vault_id is None:
            self._send(404, {"error": "找不到存档接口"})
            return
        path = archive_path(vault_id)
        if not path.is_file():
            self._send(404, {"error": "该 TeamSpeak ID 还没有存档"})
            return
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            self._send(500, {"error": "存档损坏"})
            return
        self._send(200, payload)

    def do_PUT(self) -> None:  # noqa: N802
        if not allowed(self._client_ip()):
            self._send(429, {"error": "请求过于频繁"})
            return
        vault_id = self._vault_id()
        if vault_id is None:
            self._send(400, {"error": "TeamSpeak ID 无效"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BYTES:
            self._send(413, {"error": "存档过大或为空"})
            return
        raw = self.rfile.read(length)
        try:
            document = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send(400, {"error": "存档不是有效 JSON"})
            return
        if not isinstance(document, dict) or document.get("kind") != "steam-account-manager-travel":
            self._send(400, {"error": "请上传外出资料包"})
            return
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        wrapper = {
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "ts3Id": vault_id,
            "pack": document,
        }
        path = archive_path(vault_id)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(wrapper, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
        self._send(200, {"ok": True, "updatedAt": wrapper["updatedAt"]})


def self_test() -> None:
    """本地冒烟：含斜杠的 Unique ID 可以 PUT/GET 往返。"""
    import tempfile
    from urllib.error import HTTPError
    from urllib.request import Request, urlopen

    global DATA_DIR
    DATA_DIR = Path(tempfile.mkdtemp(prefix="sam-vault-"))
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    vault_id = "l/wKLOmlneDIe2kkFlHc6B0B01s="
    pack = {
        "schemaVersion": 1,
        "kind": "steam-account-manager-travel",
        "identities": [{"steamId64": "76561198000000001", "accountName": "alpha"}],
    }
    try:
        health = json.loads(urlopen(f"http://127.0.0.1:{port}/healthz", timeout=2).read())
        assert health["ok"] is True
        put = Request(
            f"http://127.0.0.1:{port}/v1/archive?id=l%2FwKLOmlneDIe2kkFlHc6B0B01s%3D",
            data=json.dumps(pack).encode("utf-8"),
            method="PUT",
            headers={"Content-Type": "application/json", "X-Ts3-Id": vault_id},
        )
        uploaded = json.loads(urlopen(put, timeout=2).read())
        assert uploaded["ok"] is True
        fetched = json.loads(
            urlopen(
                Request(
                    f"http://127.0.0.1:{port}/v1/archive?id=l%2FwKLOmlneDIe2kkFlHc6B0B01s%3D",
                    headers={"X-Ts3-Id": vault_id},
                ),
                timeout=2,
            ).read()
        )
        assert fetched["pack"]["identities"][0]["accountName"] == "alpha"
        try:
            urlopen(f"http://127.0.0.1:{port}/v1/archive?id=missingid", timeout=2)
            raise AssertionError("missing archive should 404")
        except HTTPError as error:
            assert error.code == 404
    finally:
        server.shutdown()
        server.server_close()
    print("sam-vault self-test ok", flush=True)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"sam-vault listening on {HOST}:{PORT} dir={DATA_DIR}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        main()
