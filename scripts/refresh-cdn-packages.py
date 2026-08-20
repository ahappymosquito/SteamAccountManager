#!/usr/bin/env python3
"""Refresh CDN installers from official sources and rewrite packages.json."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get("CDN_ROOT", "/var/www/cdn.qrqto.club"))
USER_AGENT = "SteamAccountManagerCDN/0.11.9"
SOURCES = {
    "steam": {
        "url": "https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe",
        "dest": ROOT / "steam" / "SteamSetup.exe",
        "public": "https://cdn.qrqto.club/steam/SteamSetup.exe",
        "version_from": "date",
    },
    "teamspeak3": {
        "url": "https://files.teamspeak-services.com/releases/client/3.6.2/TeamSpeak3-Client-win64-3.6.2.exe",
        "dest": ROOT / "teamspeak" / "TeamSpeak3-Client-win64.exe",
        "public": "https://cdn.qrqto.club/teamspeak/TeamSpeak3-Client-win64.exe",
        "version": "3.6.2",
    },
    "teamspeak3-server": {
        "url": "https://files.teamspeak-services.com/releases/server/3.13.8/teamspeak3-server_win64-3.13.8.zip",
        "dest": ROOT / "teamspeak" / "TeamSpeak3-Server-win64.zip",
        "public": "https://cdn.qrqto.club/teamspeak/TeamSpeak3-Server-win64.zip",
        "version": "3.13.8",
    },
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        print(f"keep {dest.name}: {error}")
        return dest.is_file()
    if not payload or payload[:15].lower().startswith(b"<!doctype html") or payload[:6].lower().startswith(b"<html"):
        print(f"keep {dest.name}: official response was not a binary installer")
        return dest.is_file()
    with tempfile.NamedTemporaryFile(delete=False, dir=dest.parent) as handle:
        handle.write(payload)
        temp_name = Path(handle.name)
    if dest.is_file() and sha256_file(dest) == hashlib.sha256(payload).hexdigest():
        temp_name.unlink(missing_ok=True)
        return True
    temp_name.replace(dest)
    return True


def main() -> int:
    packages = {}
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    for package_id, source in SOURCES.items():
        dest = Path(source["dest"])
        download(source["url"], dest)
        if not dest.is_file() or dest.stat().st_size <= 0:
            continue
        version = source.get("version")
        if source.get("version_from") == "date":
            version = datetime.fromtimestamp(dest.stat().st_mtime, tz=timezone.utc).date().isoformat()
        packages[package_id] = {
            "id": package_id,
            "version": version,
            "url": source["public"],
            "fileName": dest.name,
            "sha256": sha256_file(dest),
            "size": dest.stat().st_size,
            "updatedAt": datetime.fromtimestamp(dest.stat().st_mtime, tz=timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
        }
    manifest = {"updatedAt": now, "packages": packages}
    output = ROOT / "packages.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {output} with {len(packages)} packages at {now}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
