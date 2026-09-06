#!/usr/bin/env python3
"""Steam Account Manager 外出存档服务：按短名字+口令存取资料包。"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HOST = os.environ.get("SAM_VAULT_HOST", "127.0.0.1")
PORT = int(os.environ.get("SAM_VAULT_PORT", "8788"))
DATA_DIR = Path(os.environ.get("SAM_VAULT_DIR", "/var/lib/sam-vault"))
MAX_BYTES = 1_500_000
NAME_RE = re.compile(r"^[a-z0-9_\u4e00-\u9fff-]{2,24}$")
PIN_RE = re.compile(r"^[0-9A-Za-z]{4,8}$")
ID_RE = re.compile(r"^[A-Za-z0-9+/=._-]{8,80}$")
PIN_PEPPER = "sam-vault-pin-v1"
RATE_LIMIT = 20
RATE_WINDOW = 60.0
FAIL_LIMIT = 5
FAIL_WINDOW = 900.0
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Vault-Name, X-Vault-Pin, X-Ts3-Id",
    "Access-Control-Max-Age": "86400",
}

_lock = threading.Lock()
_hits: dict[str, list[float]] = {}
_fails: dict[str, list[float]] = {}


def archive_path(vault_id: str) -> Path:
    digest = hashlib.sha256(vault_id.encode("utf-8")).hexdigest()
    return DATA_DIR / f"{digest}.json"


def normalize_name(raw: str) -> str | None:
    trimmed = unquote(raw).strip()
    name = "".join(ch.lower() if ch.isascii() else ch for ch in trimmed)
    if not name or ".." in name or not NAME_RE.fullmatch(name):
        return None
    return name


def normalize_pin(raw: str) -> str | None:
    pin = raw.strip()
    if not PIN_RE.fullmatch(pin):
        return None
    return pin


def pin_hash(name: str, pin: str) -> str:
    payload = f"{PIN_PEPPER}\0{name}\0{pin}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


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


def fail_locked(ip: str, name: str) -> bool:
    now = time.time()
    key = f"{ip}\0{name}"
    with _lock:
        stamps = [stamp for stamp in _fails.get(key, []) if now - stamp < FAIL_WINDOW]
        _fails[key] = stamps
        return len(stamps) >= FAIL_LIMIT


def record_fail(ip: str, name: str) -> bool:
    now = time.time()
    key = f"{ip}\0{name}"
    with _lock:
        stamps = [stamp for stamp in _fails.get(key, []) if now - stamp < FAIL_WINDOW]
        stamps.append(now)
        _fails[key] = stamps
        return len(stamps) >= FAIL_LIMIT


def clear_fails(ip: str, name: str) -> None:
    with _lock:
        _fails.pop(f"{ip}\0{name}", None)


class Handler(BaseHTTPRequestHandler):
    server_version = "sam-vault/2"

    def log_message(self, format: str, *args: object) -> None:
        message = format % args
        lowered = message.lower()
        if any(token in lowered for token in ("apikey", "password", "pin", "口令", "x-vault")):
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

    def _query(self) -> dict[str, list[str]]:
        return parse_qs(urlparse(self.path).query, keep_blank_values=False)

    def _name_pin(self) -> tuple[tuple[str, str] | None, str]:
        query = self._query()
        raw_name = (self.headers.get("X-Vault-Name") or "").strip()
        if not raw_name:
            raw_name = (query.get("name") or [""])[0].strip()
        pin = (self.headers.get("X-Vault-Pin") or "").strip()
        if not raw_name:
            return None, ""
        name = normalize_name(raw_name)
        if name is None:
            return None, "invalid"
        if not pin:
            return None, "missing-pin"
        if normalize_pin(pin) is None:
            return None, "invalid"
        return (name, pin), ""

    def _legacy_id(self) -> str | None:
        vault_id = (self._query().get("id") or [""])[0].strip()
        if not vault_id:
            vault_id = (self.headers.get("X-Ts3-Id") or "").strip()
        if not vault_id or not ID_RE.match(vault_id) or ".." in vault_id:
            return None
        return vault_id

    def _read_json(self, path: Path) -> dict | None:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def _public_archive(self, payload: dict) -> dict:
        visible = dict(payload)
        visible.pop("pinHash", None)
        return visible

    def _reject_pin(self, ip: str, name: str) -> None:
        if record_fail(ip, name):
            self._send(429, {"error": "请求过于频繁"})
            return
        self._send(403, {"error": "口令不对"})

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        for key, value in CORS.items():
            self.send_header(key, value)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path.rstrip("/") == "/healthz":
            self._send(200, {"ok": True})
            return
        if urlparse(self.path).path.rstrip("/") != "/v1/archive":
            self._send(404, {"error": "找不到存档接口"})
            return
        if not allowed(self._client_ip()):
            self._send(429, {"error": "请求过于频繁"})
            return
        parsed, error = self._name_pin()
        if error == "invalid":
            self._send(400, {"error": "名字或口令格式不对"})
            return
        if error == "missing-pin":
            self._send(400, {"error": "请填写口令"})
            return
        ip = self._client_ip()
        if parsed:
            name, pin = parsed
            if fail_locked(ip, name):
                self._send(429, {"error": "请求过于频繁"})
                return
            path = archive_path(name)
            if not path.is_file():
                self._send(404, {"error": "还没有这个名字的存档，请先在家用机上传"})
                return
            payload = self._read_json(path)
            if payload is None:
                self._send(500, {"error": "存档损坏"})
                return
            stored = payload.get("pinHash")
            if not isinstance(stored, str) or not hmac.compare_digest(stored, pin_hash(name, pin)):
                self._reject_pin(ip, name)
                return
            clear_fails(ip, name)
            self._send(200, self._public_archive(payload))
            return
        vault_id = self._legacy_id()
        if vault_id is None:
            self._send(400, {"error": "请填写名字和口令"})
            return
        path = archive_path(vault_id)
        if not path.is_file():
            self._send(404, {"error": "该 TeamSpeak ID 还没有存档"})
            return
        payload = self._read_json(path)
        if payload is None:
            self._send(500, {"error": "存档损坏"})
            return
        self._send(200, self._public_archive(payload))

    def do_PUT(self) -> None:  # noqa: N802
        if urlparse(self.path).path.rstrip("/") != "/v1/archive":
            self._send(404, {"error": "找不到存档接口"})
            return
        if not allowed(self._client_ip()):
            self._send(429, {"error": "请求过于频繁"})
            return
        parsed, error = self._name_pin()
        if error == "invalid":
            self._send(400, {"error": "名字或口令格式不对"})
            return
        if error == "missing-pin":
            self._send(400, {"error": "请填写口令"})
            return
        ip = self._client_ip()
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
        updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if parsed:
            name, pin = parsed
            if fail_locked(ip, name):
                self._send(429, {"error": "请求过于频繁"})
                return
            path = archive_path(name)
            if path.is_file():
                payload = self._read_json(path)
                stored = payload.get("pinHash") if payload else None
                if not isinstance(stored, str) or not hmac.compare_digest(stored, pin_hash(name, pin)):
                    self._reject_pin(ip, name)
                    return
            wrapper = {
                "updatedAt": updated_at,
                "name": name,
                "pinHash": pin_hash(name, pin),
                "pack": document,
            }
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(wrapper, ensure_ascii=False), encoding="utf-8")
            tmp.replace(path)
            clear_fails(ip, name)
            self._send(200, {"ok": True, "updatedAt": updated_at})
            return
        vault_id = self._legacy_id()
        if vault_id is None:
            self._send(400, {"error": "请填写名字和口令"})
            return
        wrapper = {
            "updatedAt": updated_at,
            "ts3Id": vault_id,
            "pack": document,
        }
        path = archive_path(vault_id)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(wrapper, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
        self._send(200, {"ok": True, "updatedAt": updated_at})


def self_test() -> None:
    """本地冒烟：短名字+口令往返，错误口令拒绝，且磁盘不存明文口令。"""
    import tempfile
    from urllib.error import HTTPError
    from urllib.request import Request, urlopen

    global DATA_DIR
    DATA_DIR = Path(tempfile.mkdtemp(prefix="sam-vault-"))
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    pack = {
        "schemaVersion": 1,
        "kind": "steam-account-manager-travel",
        "identities": [{"steamId64": "76561198000000001", "accountName": "alpha"}],
    }
    name = "小明"
    encoded = "%E5%B0%8F%E6%98%8E"
    pin = "2468"
    try:
        health = json.loads(urlopen(f"http://127.0.0.1:{port}/healthz", timeout=2).read())
        assert health["ok"] is True
        put = Request(
            f"http://127.0.0.1:{port}/v1/archive?name={encoded}",
            data=json.dumps(pack).encode("utf-8"),
            method="PUT",
            headers={
                "Content-Type": "application/json",
                "X-Vault-Name": encoded,
                "X-Vault-Pin": pin,
            },
        )
        uploaded = json.loads(urlopen(put, timeout=2).read())
        assert uploaded["ok"] is True
        fetched = json.loads(
            urlopen(
                Request(
                    f"http://127.0.0.1:{port}/v1/archive?name={encoded}",
                    headers={"X-Vault-Name": encoded, "X-Vault-Pin": pin},
                ),
                timeout=2,
            ).read()
        )
        assert fetched["pack"]["identities"][0]["accountName"] == "alpha"
        assert "pinHash" not in fetched
        stored = json.loads(archive_path(name).read_text(encoding="utf-8"))
        assert stored["name"] == name
        assert pin not in json.dumps(stored)
        assert stored["pinHash"] == pin_hash(name, pin)
        try:
            urlopen(
                Request(
                    f"http://127.0.0.1:{port}/v1/archive?name={encoded}",
                    headers={"X-Vault-Name": encoded, "X-Vault-Pin": "0000"},
                ),
                timeout=2,
            )
            raise AssertionError("wrong pin should 403")
        except HTTPError as error:
            assert error.code == 403
        try:
            urlopen(f"http://127.0.0.1:{port}/v1/archive?name=nobody", timeout=2)
            raise AssertionError("missing pin should 400")
        except HTTPError as error:
            assert error.code == 400
        vault_id = "l/wKLOmlneDIe2kkFlHc6B0B01s="
        legacy_put = Request(
            f"http://127.0.0.1:{port}/v1/archive?id=l%2FwKLOmlneDIe2kkFlHc6B0B01s%3D",
            data=json.dumps(pack).encode("utf-8"),
            method="PUT",
            headers={"Content-Type": "application/json", "X-Ts3-Id": vault_id},
        )
        assert json.loads(urlopen(legacy_put, timeout=2).read())["ok"] is True
        legacy = json.loads(
            urlopen(
                Request(
                    f"http://127.0.0.1:{port}/v1/archive?id=l%2FwKLOmlneDIe2kkFlHc6B0B01s%3D",
                    headers={"X-Ts3-Id": vault_id},
                ),
                timeout=2,
            ).read()
        )
        assert legacy["pack"]["identities"][0]["accountName"] == "alpha"
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
