# 完美世界竞技平台：SteamID 自动匹配与玩家分数查询研究

> 核对日期：2026-07-27。本文只基于完美平台网页请求的开源复现代码和成熟项目源码，没有调用真实账号或真实平台接口。完美平台没有公开、稳定的玩家数据 API 文档，因此下述接口均应视为非公开网页接口。

## 结论

- **可以按现有 Steam 账号的 SteamID 自动定位完美平台玩家**。已验证实现直接把 17 位 SteamID64 作为 `uid` 查询参数，并同时放入 `pwasteamid`、`PwaSteamId`、`x-pwa-steamid` 请求头；没有额外的“完美玩家 ID → SteamID”转换步骤。源码给出的示例格式为 `76561198159976336`。[请求入口与 SteamID 示例](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L312-L339)、[请求头](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L642-L663)
- **只有 SteamID 不足以完成当前分数或战绩查询**。参考实现的所有用户列表、赛季及详情请求都要求 `access_token`；主列表还需要专有签名字段 `a/r/s/t`。源码没有可复用的公开签名算法，只定义了编译 signer 的调用边界。[签名参数](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L235-L258)、[私有 signer 边界](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L42-L143)
- **匿名查询能力未被验证，不能作为产品能力承诺**。开源实现没有无 Token 的玩家资料、当前段位或当前分数请求；`access_token` 同时出现在查询参数、JSON 请求体和 `steam_cn_token` Cookie 中。[鉴权头](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L642-L663)、[比赛详情请求](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L737-L766)
- **段位与分数字段存在，但需要明确口径**。比赛玩家记录暴露 `score`、`level`、`rank`、`rank_name`、`change_score`、`elo`；其中 `score` 更适合作为 UI 中的“完美平台分数”，`rank_name` 作为段位名称。源码只做字段透传，没有证明 `score` 是赛前还是赛后值，也没有证明 `elo` 与 `score` 等价，因此不能自行相加或互相替代。[玩家天梯字段映射](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L1182-L1192)

## 已验证的请求链路

### 1. 目标玩家标识

输入应使用 SteamID64：

```text
76561198159976336
```

参考实现把同一个值用于：

```text
query.uid
header.pwasteamid
header.PwaSteamId
header.x-pwa-steamid
```

因此，Steam Account Manager 已保存的 SteamID64 足以完成“账号 → 完美平台目标玩家”的自动匹配，不需要用户重复输入平台账号。代码还支持一个默认 Token 对多个目标 `steamid` 使用，并允许单个目标覆盖 Token；这说明该开源实现按“鉴权会话 + 任意目标 uid”设计，但完美平台没有公开承诺跨用户查询权限，实际可见范围仍需按返回结果处理。[配置模型](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/config.py#L16-L37)、[默认 Token 继承](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/config.py#L66-L78)

当前没有源码证据支持 SteamID2（如 `STEAM_0:1:...`）、SteamID3（如 `[U:1:...]`）或 Steam 个人主页短链接直接传给完美接口。产品侧应先统一解析成 17 位 SteamID64，再调用 Provider。

### 2. 最近天梯比赛及分数

首选接口：

```http
GET https://pwaweblogin.wmpvp.com/user-info/recent-ladder-score-list
```

业务参数：

```text
access_token=<登录 Token>
uid=<目标 SteamID64>
size=<数量>
season=<可选赛季>
```

签名参数：

```text
a=20000
r=<6 位随机数>
s=<专有签名>
t=<Unix 秒>
```

响应预期为 `data[]`，每项包含比赛摘要，至少以 `match` 标识比赛。该请求的 `s` 依赖私有编译 signer；仓库公开部分只保留函数边界，无法据此在 Rust 中独立重写算法。[接口定义与签名](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L21-L39)、[列表请求](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L414-L453)

首选接口无结果时，参考实现回退到：

```http
GET https://pwaweblogin.wmpvp.com/user-info/match-list
```

参数包括：

```text
access_token
uid
page
page_size
season
game_types
ticket_id
start_time
end_time
```

此接口可能返回 `data.e` 与 `data.t` 加密体。公开源码同样没有解密算法，只允许注入私有解密器、编译扩展或外部程序；没有解密器时返回空列表。[回退与加密响应](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L456-L510)

### 3. 当前赛季和历史赛季

当前赛季：

```http
POST https://pwaweblogin.wmpvp.com/user-info
Cookie: steam_cn_token=<access_token>
PwaSteamId: <SteamID64>
```

参考实现只读取 `data.season`，没有从该接口读取当前分数或段位。[当前赛季读取](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L563-L580)

历史赛季：

```http
GET https://pwaweblogin.wmpvp.com/user-info/season-ladder-score-list
```

参数：

```text
access_token=<登录 Token>
uid=<目标 SteamID64>
ignore_season=<可选>
```

响应预期为 `data[]`。参考测试使用的赛季记录字段包括 `season`、`match_count`、`score`；但该项目用它来寻找候选历史赛季，而不是把它当作已验证的“实时当前分数”接口。[历史赛季读取](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L582-L639)、[固定响应测试](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/tests/test_config_cli_utils.py#L586-L645)

### 4. 比赛详情及玩家字段

详情接口：

```http
POST https://pwaweblogin.wmpvp.com/match-api/report
Content-Type: application/json
x-pwa-steamid: <SteamID64>
pwasteamid: <SteamID64>

{
  "access_token": "<登录 Token>",
  "match_id": "<比赛 ID>"
}
```

回合接口：

```http
POST https://pwaweblogin.wmpvp.com/match-api/match-round-simple-list

{
  "access_token": "<登录 Token>",
  "match_id": "<比赛 ID>"
}
```

详情 `report.players[]` 可按 `steam_id`、`user_id` 或 `uid` 识别目标玩家，字段包括：

- 身份：`steam_id`、`steam_nick`、头像；
- 战绩：`kill`、`death`、`assist`、`rating`/`pw_rating`、`adpr`、`rws`、`headshot_kill_count`；
- 天梯：`score`、`level`、`rank`、`rank_name`、`change_score`、`elo`。

注意平台 ADR 原字段拼写是 `adpr`。参考实现把上述字段标准化后保留原始值。[详情及回合请求](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L737-L825)、[玩家字段标准化](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/src/cs_demo_downloader/core/downloader_pwa.py#L1142-L1192)

## 认证和失败语义

### `access_token` 是否必需

就当前可复现链路而言，**必需**：

- 列表请求：查询参数和 `steam_cn_token` Cookie；
- 赛季请求：查询参数和 Cookie；
- 比赛详情、回合：JSON 请求体；
- Demo URL：查询参数，且另需签名。

该 Token 应按敏感凭据处理，只存 Windows Credential Manager，不写入 SQLite、日志、导入导出或错误消息。参考项目自身也对 URL 中的 `access_token` 和签名字段做脱敏处理。[敏感字段脱敏测试](https://github.com/WangChuDi/CS-Demo-Downloader/blob/4dfb10c97dadd50a2b61d913aef5eb1069a2b98e/tests/test_config_cli_utils.py#L367-L405)

### 可区分的失败

Provider 应将失败至少分为：

- `credential_required`：未配置 Token，不发起平台请求；
- `credential_expired`：HTTP 401/403，或平台明确返回登录失效代码；
- `signer_unavailable`：无法生成 `s`，不能调用首选列表；
- `decryptor_unavailable`：回退列表返回 `data.e/data.t`，但无解密组件；
- `player_not_found`：请求成功且能确认 SteamID 未绑定/无该用户；
- `no_matches`：用户存在但当前赛季没有比赛；
- `partial_data`：能拿到比赛摘要或历史赛季分数，但详情/当前段位缺失；
- `schema_changed`：HTTP 成功但关键容器或身份字段结构改变；
- `rate_limited` / `network_error`：429、超时或 5xx。

不能把所有 HTTP 200 的空数组都归类为“未绑定完美平台”：在缺 signer、Token 权限不足、赛季切换、加密体无法解密或接口结构变化时，参考实现同样会退化为空数组。

## 对当前产品实现的直接建议

1. 自动关联入口可直接使用账号的 SteamID64，不要求用户填写完美平台 ID；平台关联记录的 `externalId` 保存规范化 SteamID64。
2. 没有 Token 时只展示“已按 SteamID 识别，配置完美平台 Token 后查询段位和战绩”，不要显示虚假的零分或“未绑定”。
3. 第一阶段只有在提供可合法分发、可维护的 signer 时，才把 `recent-ladder-score-list` 作为生产查询链路；否则本期只能落地 Provider、凭据和 UI 状态，不能宣称已支持实时分数。
4. UI 分数标签应为“完美平台分数”，来源字段优先 `score`；段位使用 `rank_name`，变化使用 `change_score`。`elo` 单独保留来源，不与 `score` 混算。
5. 当前分数优先取最新一场已完成比赛中目标玩家的 `score`，并明确标注“最近比赛记录分数”；只有抓包或第一方响应确认其为实时值后，才改成“当前分数”。
6. `akiver/cs-demo-manager` 当前只通过 Demo 的服务器名称包含“完美世界”识别来源，没有提供完美玩家资料、SteamID 自动匹配或段位查询实现，因此不能补足上述 signer/Token 缺口。[Perfect World Demo 来源识别](https://github.com/akiver/cs-demo-manager/blob/7ec6f6202b81d0556432e0390883f72bfe288714/src/node/demo/get-demo-from-file-path.ts#L81-L107)

## 风险边界

- 接口、字段、客户端版本、签名和加密方式均可能随完美平台更新而变化。
- `access_token` 的跨目标查询权限没有官方文档保证；共享 Token 查询多个 SteamID只是参考实现支持的调用方式。
- `score`、`elo`、`change_score` 的精确赛前/赛后语义没有公开契约，应保留来源并采用保守 UI 文案。
- 不应将逆向签名算法、私有二进制或来源不明的 Token 打包进正式安装包；这涉及安全、维护和可能的服务条款风险。
