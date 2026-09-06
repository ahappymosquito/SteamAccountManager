# TeamSpeak Unique ID 外出存档服务

按用户自己的 TeamSpeak 3 Unique ID 存取 Steam Account Manager 外出资料包，挂在 `https://cdn.qrqto.club/vault/`。

Unique ID 是存档钥匙：相同 ID 拉取同一份资料。它本身是公开标识，知道 ID 就能读取资料包里的 5E/完美明文，因此不要把别人的 ID 填进客户端。磁盘文件名是 ID 的 SHA-256，访问日志关闭 query string。

## 接口

- `GET /healthz`
- `GET /v1/archive?id=<Unique ID>`
- `PUT /v1/archive?id=<Unique ID>`，正文为 `kind=steam-account-manager-travel` 的资料包

也可使用请求头 `X-Ts3-Id`。Unique ID 可能含 `+` `/` `=`，必须放在 query 或请求头，不能放进路径。

## 部署

服务以 `www-data` 监听 `127.0.0.1:8788`，数据目录 `/var/lib/sam-vault`，由 nginx `/vault/` 反代。
