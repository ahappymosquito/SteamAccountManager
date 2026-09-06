# 外出存档服务

按用户自己起的短名字加口令存取 Steam Account Manager 外出资料包，挂在 `https://cdn.qrqto.club/vault/`。

短名字可猜测，因此读写都必须带口令。磁盘文件名是名字的 SHA-256，口令只存哈希；访问日志关闭 query string，也不会记录口令。同一名字首次上传时绑定口令。

旧版 TeamSpeak Unique ID 接口仍可读取既有存档，新客户端只用名字和口令。

## 接口

- `GET /healthz`
- `GET /v1/archive?name=<短名字>`，请求头 `X-Vault-Pin`
- `PUT /v1/archive?name=<短名字>`，请求头 `X-Vault-Pin`，正文为 `kind=steam-account-manager-travel` 的资料包

中文名字必须百分号编码。口令只放请求头，不要放进 URL。

## 部署

服务以 `www-data` 监听 `127.0.0.1:8788`，数据目录 `/var/lib/sam-vault`，由 nginx `/vault/` 反代。
