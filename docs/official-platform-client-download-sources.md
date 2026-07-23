# 平台 Windows 客户端官方下载源核验

> 核验日期：2026-07-23（Asia/Shanghai）  
> 范围：完美世界竞技平台、5E 对战平台、TeamSpeak 3 Windows 客户端。  
> 来源限制：仅使用平台所有者的官网、官方静态资源、官方 CDN 和官方条款；未采用第三方下载站或镜像。

## 结论

| 平台 | 官方入口 | 当前版本 | 机器可读版本来源 | 应用内下载与进度管理 |
|---|---|---|---|---|
| 完美世界竞技平台 | [`pvp.wanmei.com`](https://pvp.wanmei.com/) | `1.0.26072311` | 官方 [`latest.yml`](https://client.wmpvp.com/download/latest.yml)，含 EXE 文件名、长度、SHA-512 和发布日期 | **推荐支持**。官方文件 CDN 支持字节范围请求，可校验长度和哈希并实现暂停/续传 |
| 5E 对战平台 | [`csgo.5eplay.com`](https://csgo.5eplay.com/) | `8.2.6` | 未发现公开、受支持的版本 API；版本文字由官网页面直接呈现 | **只能尽力支持并保留浏览器回退**。官网给出稳定的浏览器下载别名，但自动化请求当前会先收到 WAF HTML 挑战 |
| TeamSpeak 3 | [TeamSpeak Downloads](https://www.teamspeak.com/en/downloads/) | `3.6.2`（Windows x64） | 未发现公开、受支持的版本 API；版本、版本化 URL 和 SHA-256 嵌在官方下载页 | **推荐支持**。官方版本化文件支持长度和字节范围请求，且有官方 SHA-256 |

“当前版本”是核验时的快照，不能硬编码为永久值。产品应在用户点击下载前重新读取对应官方来源。

## 完美世界竞技平台

### 官方入口与动态下载规则

[完美世界竞技平台官网](https://pvp.wanmei.com/)提供“立即下载”和“免安装绿色版下载”，并标注支持 Windows 10 及以上。官网自身脚本 [`umi.7a7b3b08.js`](https://pvp.wanmei.com/pvp/umi.7a7b3b08.js) 将客户端 CDN 基址定义为 `https://client.wmpvp.com`，先读取 [`/download/latest.yml`](https://client.wmpvp.com/download/latest.yml) 的 `version`，再构造以下地址：

```text
https://client.wmpvp.com/download/perfectworldarena_win32_v{version}.exe
https://client.wmpvp.com/download/perfectworldarena_win32_v{version}.zip
```

因此，`latest.yml` 是目前最适合应用使用的第一方版本发现入口；不应把某个版本化 URL 永久写死。

### 当前元数据与文件

核验时 [`latest.yml`](https://client.wmpvp.com/download/latest.yml) 返回 `200 OK`，最终 URL 不变，内容为 UTF-8 文本，主要字段如下：

```yaml
version: 1.0.26072311
path: perfectworldarena_win32_v1.0.26072311.exe
size: 302195128
sha512: iVRHmzFexv5mGKCcdrEWkD2+0YaeSttVYX7ujH9kVkZCRYrhiiYWSeP1aZD9oaIKCz6+zwPfBWvnxihiWTCkSA==
releaseDate: 2026-07-22T10:45:24.186Z
```

对应第一方文件：

- [安装版 EXE](https://client.wmpvp.com/download/perfectworldarena_win32_v1.0.26072311.exe)：`302,195,128` 字节，`application/octet-stream`。
- [免安装 ZIP](https://client.wmpvp.com/download/perfectworldarena_win32_v1.0.26072311.zip)：`339,419,366` 字节，`application/zip`。

两个文件的 HEAD 请求均为 `200 OK`、没有重定向。CDN 返回 `Accept-Ranges: bytes`，对 EXE 的单字节范围请求返回 `206 Partial Content` 和完整总长度，适合显示下载进度、暂停和断点续传。

### 安全与更新边界

- 默认推荐 EXE。官方元数据同时给出其文件长度和 SHA-512；下载完成后应同时校验两者，成功后才允许用户运行。
- ZIP 虽由官网脚本构造且当前存在，但 `latest.yml` 没有提供 ZIP 的长度或哈希。可将其标为“免安装版”，同时明确其完整性只能依赖 HTTPS/CDN，不能宣称已经通过官方哈希验证。
- `latest.yml` 的响应类型是 `application/octet-stream`，但内容实际是 YAML 文本。应按 UTF-8 读取，并用安全的字段解析方式处理；不得启用 YAML 任意对象反序列化。
- 仅接受 HTTPS 且主机名精确为 `client.wmpvp.com`；版本号和文件名须严格校验，不能允许元数据注入任意主机、路径或本地文件名。
- 元数据和大文件 CDN 更新可能短暂不同步。遇到 `404`、长度或哈希不符时，应重新拉取一次 `latest.yml` 后重试；不能自动回退到第三方镜像。
- 官方脚本还保留较旧的 Dota 2 通道 `https://client.wmpvp.com/dota2/latest.yml`。该通道核验时仍指向 2024 年版本，不能当作当前通用/CS2 客户端最新版。

## 5E 对战平台

### 官方入口、版本与浏览器下载别名

[5EPlay 官方 CS2 页面](https://csgo.5eplay.com/)当前将主按钮标为“立即下载”，显示“当前版本 8.2.6”，并把按钮指向：

```text
https://arena.5eplay.com/download/latest
```

官网还链接到 [`https://arena.5eplay.com/update`](https://arena.5eplay.com/update) 作为更新日志入口。`5ewin.com` 在官网中仍有旧用户入口，但当前新客户端的主下载入口已经是上述 `5eplay.com` 域名链路，不应优先使用历史域名。

### 重定向和版本元数据能力

`/download/latest` 是第一方、无版本号的浏览器下载别名，适合用户从官网点击，但它不是一个已公开文档化的下载 API。

2026-07-23 使用 `curl` 对该地址执行 HEAD（包括普通浏览器 User-Agent、官网 Referer 和跟随最多 10 次重定向）时，结果均为：

- `200 OK`，没有返回 `Location`；
- `Content-Type: text/html; charset=utf-8`；
- 内容是阿里云 WAF JavaScript 挑战页，而不是 Windows 安装包。

这意味着普通浏览器完成挑战后可能继续到实际文件，但原生 HTTP 下载器不能假设这个 URL 会直接返回二进制文件。核验官网 HTML 和公开第一方页面后，也未发现受支持的 JSON/YAML 版本 API、固定的当前安装包 URL、文件长度或官方校验和。

### 产品实现建议

- “官网下载”按钮可始终指向 [`https://arena.5eplay.com/download/latest`](https://arena.5eplay.com/download/latest)，这是官网当前采用的第一方入口。
- 应用内下载器只有在最终响应满足“HTTPS、受信任的 5E 第一方主机、非 HTML、合理的文件名和大小”后才开始记录下载进度。
- 若收到 WAF HTML、挑战 Cookie、`403`、`429` 或无法取得二进制响应，应立即回退为“在浏览器中打开官方下载”，并在 UI 中说明下载由浏览器管理；不要把挑战页保存为 `.exe`。
- 不建议逆向客户端 updater、复用非公开接口或绕过 WAF。这些方式没有公开稳定性承诺，也会扩大安全和维护风险。
- 官网版本 `8.2.6` 可用于展示和检测变化，但页面解析应低频缓存，并在结构变化时安全失败；它不是正式 API 契约。
- 官方资料说明 5E Anti-Cheat 会校验 Steam/游戏关键文件并检测内存中的非法模块；近期官方公告也说明其反作弊和硬件风控仍在持续更新。[5E 反作弊说明](https://csgo.5eplay.com/article/1194144)、[风控系统 2.0 公告](https://csgo.5eplay.com/article/2512180lgqnx)。因此安装/启动应由用户明确触发，不应自动静默运行安装程序，也不应替用户关闭杀毒或安全防护。

## TeamSpeak 3

### 官方入口与当前客户端

[TeamSpeak 官方下载页](https://www.teamspeak.com/en/downloads/)当前列出 TeamSpeak 3 Windows `Client 64-bit • 3.6.2`，下载按钮直接指向版本化文件：

```text
https://files.teamspeak-services.com/releases/client/3.6.2/TeamSpeak3-Client-win64-3.6.2.exe
```

对应第一方资源：

- [Windows x64 安装包](https://files.teamspeak-services.com/releases/client/3.6.2/TeamSpeak3-Client-win64-3.6.2.exe)
- [3.6.2 官方发行目录](https://files.teamspeak-services.com/releases/client/3.6.2/index.html)
- [Windows x86 安装包（兼容用途）](https://files.teamspeak-services.com/releases/client/3.6.2/TeamSpeak3-Client-win32-3.6.2.exe)

当前下载页只把 Windows x64 作为推荐客户端。发行目录仍保留 x86 文件，但产品应将其标为旧系统兼容选项，而非默认选择。

### 文件响应与版本元数据

x64 版本化 URL 直接返回 `200 OK`，没有中间跳转，主要响应特征为：

```text
Content-Type: application/octet-stream
Content-Length: 113041880
Accept-Ranges: bytes
SHA-256: eab9e0c1a7134643e5f7116b7e0e58faffb20d6db528f8b333d2c2b5d1ab68ae
```

官方 SHA-256 由[官方下载页](https://www.teamspeak.com/en/downloads/?a=)公开。长度、字节范围和 ETag 足以实现进度显示及断点续传；完成后必须核验官方下载页公布的 SHA-256。

核验时未发现 TeamSpeak 官方公开、受支持的“当前 TS3 客户端版本”API。版本号、版本化 URL 和 SHA-256 都嵌在官方下载页 HTML 中。因此应低频解析并缓存官方下载页，将固定版本 URL 仅作短期回退，不能把非公开 updater 端点当作稳定 API。

### 生命周期和请求限制

[TeamSpeak 官方条款](https://www.teamspeak.com/en/terms-and-conditions)第 12 节说明，TeamSpeak 3 在阶段性过渡期间继续支持，但计划于 **2027-12-31** 完成 EOL；官方可能调整下载、更新通道、兼容性和支持方式。平台页应提示这一生命周期状态，并允许未来迁移到 TeamSpeak 6。

官方下载页受 Cloudflare 保护，频繁版本检查可能触发 `429` 或挑战。应用应设置较长缓存周期、指数退避和用户手动刷新，不能高频轮询。

## 统一下载管理要求

1. **运行时发现版本**：完美世界读取 `latest.yml`；TeamSpeak 解析官方下载页；5E 读取官网版本文字并使用官方 browser alias，遇到 WAF 即回退浏览器。
2. **严格主机白名单**：
   - 完美世界：`pvp.wanmei.com`、`client.wmpvp.com`
   - 5E：`csgo.5eplay.com`、`arena.5eplay.com`
   - TeamSpeak：`www.teamspeak.com`、`files.teamspeak-services.com`
3. **安全跟随重定向**：每一跳都必须是 HTTPS 且仍在该平台白名单内；限制重定向次数，拒绝降级到 HTTP、IP 地址、用户信息 URL 或跨平台主机。
4. **临时文件和恢复**：下载到应用专用临时目录的 `.part` 文件；记录源 URL、版本、期望长度、ETag/Last-Modified 和已下载字节。服务端支持 `Range` 时才续传；若实体标识变化则丢弃旧分片并重新下载。
5. **完成校验**：完美世界 EXE 校验长度 + SHA-512；TeamSpeak 校验长度 + SHA-256；5E 没有公开校验和时至少验证来源、内容类型、PE 文件头、合理大小，并提示“官方未提供可机器校验的哈希”。
6. **安装必须二次确认**：下载完成不等于授权执行。显示来源、版本、大小和验证结果，由用户点击后再启动安装程序；不要静默安装、提权或关闭安全软件。
7. **可观测状态**：统一展示“解析版本、等待下载、下载中、已暂停、校验中、已完成、官网回退、失败”状态；把 WAF/限流与普通网络失败区分开。

## 第一方来源索引

- [完美世界竞技平台官网](https://pvp.wanmei.com/)
- [完美世界当前版本元数据](https://client.wmpvp.com/download/latest.yml)
- [5EPlay 官方 CS2 页面](https://csgo.5eplay.com/)
- [5E 官方浏览器下载别名](https://arena.5eplay.com/download/latest)
- [TeamSpeak 官方下载页](https://www.teamspeak.com/en/downloads/)
- [TeamSpeak 3.6.2 官方发行目录](https://files.teamspeak-services.com/releases/client/3.6.2/index.html)
- [TeamSpeak 官方条款](https://www.teamspeak.com/en/terms-and-conditions)
