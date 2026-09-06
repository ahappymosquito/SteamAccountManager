# Deploy the name+PIN vault server to the CDN host and restart it.
param(
    [string]$RemoteHost = "root_qrqto"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$server = Join-Path $projectRoot "scripts\vault-server\vault_server.py"
$nginx = Join-Path $projectRoot "scripts\vault-server\nginx-vault.inc"

if (-not (Test-Path -LiteralPath $server -PathType Leaf)) {
    throw "vault_server.py not found: $server"
}

scp -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new `
    $server "${RemoteHost}:/opt/sam-vault/vault_server.py"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to upload vault_server.py to $RemoteHost"
}

if (Test-Path -LiteralPath $nginx -PathType Leaf) {
    scp -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new `
        $nginx "${RemoteHost}:/etc/nginx/snippets/sam-vault.conf"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upload sam-vault.conf to $RemoteHost"
    }
}

$remote = @'
set -e
python3 -m py_compile /opt/sam-vault/vault_server.py
systemctl restart sam-vault
systemctl is-active --quiet sam-vault
nginx -t
systemctl reload nginx
curl -fsS http://127.0.0.1:8788/healthz >/dev/null
'@

ssh -o BatchMode=yes -o ConnectTimeout=20 $RemoteHost $remote
if ($LASTEXITCODE -ne 0) {
    throw "Failed to restart sam-vault on $RemoteHost"
}

Write-Output "Published vault server to $RemoteHost"
