# Steam Account Manager 项目结构

> 职责：记录项目的模块边界、入口、核心调用链、测试与构建布局，帮助开发者快速定位代码。

## 扫描基线

- 扫描工具：CodeGraph 1.4.1
- 扫描日期：2026-07-30
- 索引规模：68 个文件、1,201 个节点、3,412 条边
- 本地索引：`.codegraph/codegraph.db`，由 `.codegraph/.gitignore` 排除，不提交机器相关数据库

## 总体架构

```text
React 视图与交互
  src/main.tsx
      └─ App.tsx
          ├─ pages/ + components/
          ├─ store.ts / cfgWorkspace.ts
          └─ lib/api.ts
                  │ Tauri invoke / Channel
                  ▼
Rust IPC 与业务编排
  src-tauri/src/main.rs
      └─ lib.rs
          ├─ database.rs
          ├─ steam/
          ├─ cs2.rs
          ├─ player_query.rs
          ├─ software.rs
          └─ app_update.rs
                  │
                  ▼
SQLite、Steam 文件/注册表/进程、平台接口与 Windows 安装环境
```

前端不直接访问本机文件、注册表或进程。所有有系统副作用的能力都集中在 `src/lib/api.ts` 定义的类型化 IPC 边界之后，由 `src-tauri/src/lib.rs` 注册和编排。

## 顶层目录

| 路径 | 职责 |
| --- | --- |
| `src/` | React WebView 前端、页面、组件、状态和纯 TypeScript 领域逻辑 |
| `src-tauri/` | Tauri/Rust 桌面后端、SQLite、Steam/CS2/平台集成和 Windows 打包配置 |
| `tests/fixtures/` | Steam `loginusers.vdf` 解析测试数据 |
| `public/` | 应用图标及 Steam、5E、完美、TeamSpeak 平台品牌静态资源 |
| `scripts/` | 图标校验、CDN 刷新与 Windows 双产物归档脚本 |
| `docs/` | 平台调研、配置资料和项目结构文档 |
| `release/` | 本地交付的安装版、便携版与 [`CHANGELOG.md`](../release/CHANGELOG.md)；二进制不提交 Git，更新日志提交 |
| `.codegraph/` | 每台机器独立生成的代码图数据库；仅提交忽略规则 |

## 前端结构

### 启动与应用壳

- `src/main.tsx`：React 根入口，恢复主题并安装 Radix Tooltip Provider。
- `src/App.tsx`：应用壳和主要用例编排；持有账号、当前 Steam 状态、登录会话、主题与更新状态，按 `useUi.page` 切换页面，并在账号页每 10 秒静默扫描本机状态。
- `src/store.ts`：Zustand UI 状态，管理页面、搜索、收藏、平台、5E 排序、标签和通知；账号自定义顺序持久化在后端普通设置中。
- `src/cfgWorkspace.ts`：CFG 草稿状态与串行保存；账号切换前由 `flushCfgDraft()` 保证草稿落盘。

### 页面

- `pages/Cs2Page.tsx`：CFG 方案文件管理、源码编辑、注释刷新与导入导出。
- `pages/PlatformsPage.tsx`：统一管理 Steam、5E、完美和 TeamSpeak 3 的发现、下载、路径配置、启动与可持久化拖拽顺序。
- `pages/SettingsPage.tsx`：切换超时、默认折叠的平台凭据、统一数据导入导出与备份恢复。版本与更新入口在左侧栏底部。
- 软件备份导出保持全量；恢复命令接收分类选择，并在数据库层按 SteamID64 将账号资料映射到本机当前可用账号。
- 账号列表与切换日志目前仍由 `App.tsx` 内部的 `AccountsPage`、`LogsPage` 实现。

### 组件

- 账号域：`AccountDrawer`、`PlatformAccountDialog`、`AccountAvatar`、`AccountPlatformBadges`、`PlayerDataPanel`、`TagFilter`。平台编辑由独立弹窗负责，详情抽屉仅以可展开卡片展示平台资料和战绩。
- Steam 域：`CurrentSteamStatus`、`SteamLoginDialog`、`SwitchDialog`。
- CFG 域：CS2 页直接编辑源码，可复制准星命令，不再提供可视化预览。
- 应用壳：`TitleBar`、`AppUpdateBanner`。

### 前端领域与边界

- `lib/api.ts`：唯一的 Tauri IPC 门面，共集中声明账号、平台、CFG、软件、数据和更新命令。
- `lib/types.ts`：前后端交换模型的 TypeScript 表示。
- `lib/cfgDocument.ts`：无损 CFG 解析、当前 CS2 指令注释、默认模板和局部更新。
- `lib/crosshair.ts`：准星命令读取、分享码与 CFG 输出。
- `lib/filter.ts`：账号筛选。
- `lib/themes.ts`：主题解析、持久化和 DOM 应用。
- `lib/switchResult.ts`：后端切换结果到 UI 通知的映射。

## Rust/Tauri 结构

### 组合根

- `src-tauri/src/main.rs`：Windows 二进制入口，只调用 `steam_account_manager_lib::run()`。
- `src-tauri/src/lib.rs`：应用组合根、`AppState`、Tauri 插件、IPC 命令和跨模块业务工作流。
- `AppState` 共享 SQLite 连接、应用数据目录、账号切换锁、软件启动锁、Steam 登录会话和下载进度。
- `run()` 初始化应用数据目录和 SQLite，启动 5E 定时刷新 worker，注册 Dialog、Opener、Clipboard、Updater 插件与全部命令。

### 后端模块

| 模块 | 职责 |
| --- | --- |
| `database.rs` | SQLite 初始化、查询和写入；账号、标签、平台关联、缓存、CFG、设置和日志持久化 |
| `steam/mod.rs` | Steam 目录发现与校验、账号读取、进程控制、注册表状态、切号、本地头像原文件缓存和平台客户端发现 |
| `steam/profile_media.rs` | 从公开 Steam 社区资料发现动态头像与头像框，校验 Steam 静态资源域名并原样缓存 |
| `steam/vdf.rs` | Valve VDF 解析 |
| `cs2.rs` | CS2 安装发现、CFG 方案文件、部署与校验 |
| `player_query.rs` | 5E/完美世界玩家数据请求、重试、定级与赛季排名解析和稳定错误映射 |
| `software.rs` | 平台软件下载、进度、路径验证和启动 |
| `app_update.rs` | Tauri Updater 检查、下载进度与安装 |
| `models.rs` | IPC、数据库与业务数据模型 |
| `error.rs` | 可序列化的稳定错误码和错误消息 |
| `migrations/001_init.sql` | 当前 SQLite schema 的幂等初始化 |

## 关键调用链

### 应用初始化与账号同步

```text
App.useEffect
  → api.initializeSteam()
  → initialize_steam()
  → select_steam_path()
  → steam::discover()/validate_dir()
  → sync_local_accounts()
  → steam::read_accounts()
  → steam::sync_avatar_cache()
  → Database::sync_accounts()
  → auto_configure_platforms()
```

初始化完成后，`App.load()` 并行调用 `list_accounts`、`current_status` 和 `list_tags` 刷新主界面。

### Steam 官方登录导入

```text
App.beginLogin()
  → api.beginSteamLogin()
  → begin_steam_login()
  → steam::begin_official_login()
  → 创建五分钟登录会话
  → App 每秒调用 get_steam_login_status()
  → steam::detect_official_login()
  → sync_local_accounts()
  → 刷新账号列表
```

该流程只观察 Steam 官方登录结果，并只同步勾选“记住我”的本机账号。

### 账号切换

```text
SwitchDialog 确认
  → flushCfgDraft()
  → api.switchAccount(steamId64)
  → switch_account()
  → switch_lock 防止并发切换
  → execute_switch_workflow()
      1. 关闭 Steam
      2. 若安装 CS2，部署目标账号 CFG
      3. 切换 Steam 本地账号并重启 Steam
      4. 写入切换记录
      5. 若未开启「只切 Steam」且账号关联 5E 或完美，等待 Steam 就绪后启动对应平台
  → Database 写入 switch_logs
  → SwitchResult 返回前端
```

NSIS 安装版在 `installer-hooks.nsh` 的 `NSIS_HOOK_PREINSTALL` 中检测 WebView2 Runtime；缺失则提示并从 `https://cdn.qrqto.club/webview2/MicrosoftEdgeWebView2RuntimeInstallerX64.exe` 下载独立安装包。便携版不走该钩子。`tauri.conf.json` 将 `webviewInstallMode` 设为 `skip`，避免安装向导再向 Microsoft 静默拉引导程序。

启动扫描先同步账号再后台补齐头像。应用更新检查 `https://cdn.qrqto.club/app/latest.json`，运行中每 6 小时再查一次。平台安装包版本对照 `https://cdn.qrqto.club/packages.json`。Steam 切换成功后，前端通过 Tauri Channel 显示各切换阶段。默认「只切 Steam」不启动第三方平台。关闭开关后，5E 启动前最多等待 10 秒确认本机 `ActiveUser`；信号缺失时兼容启动，明确为其他账号时阻止启动。完美平台在 Steam 就绪后启动或重启。平台启动失败只产生警告，不回滚已完成的 Steam 切换。

### CFG 编辑与切换部署

```text
Cs2Page
  → cfgDocument/crosshair 纯前端解析与编辑
  → useCfgWorkspace 草稿
  → api.saveCfgProfile()
  → Database + managed CFG 文件
  → 账号切换时 LocalSwitchWorkflowExecutor.prepare_cs2_config()
  → 将账号绑定方案部署到 CS2
```

### 玩家平台数据

```text
AccountDrawer/PlayerDataPanel
  → api.playerData()/autoLinkPerfectWorld()
  → query_player_data()/auto_link_perfectworld()
  → PlayerQuery
  → 5E 或完美世界接口
  → SQLite 快照缓存
```

请求层对过期凭据执行匿名回退，对限流和服务端错误执行有界重试，并把无效响应转换为稳定错误码。

## 测试与验证布局

- 前端使用 Vitest、Testing Library 和 jsdom；测试文件与目标模块相邻。
- Rust 单元测试位于各模块的 `#[cfg(test)]` 中，覆盖数据库、Steam/VDF、切换工作流、CS2、平台查询和更新相关纯逻辑。
- `tests/fixtures/` 提供正常、缺字段、扩展字段和损坏的 VDF 样本。
- `npm run package:local` 串联图标检查、前端测试与构建、`cargo fmt --check`、Clippy、Rust 测试、NSIS 构建以及便携版整理。

## 定位建议

- UI 行为从 `App.tsx` 或对应 `pages/` 开始。
- IPC 名称先查 `src/lib/api.ts`，再查 `src-tauri/src/lib.rs` 同名命令。
- Steam 文件、注册表或进程问题进入 `steam/`。
- 数据持久化进入 `database.rs` 和 `migrations/`。
- CFG 文本行为先区分前端编辑逻辑 `cfgDocument.ts` 与后端文件部署 `cs2.rs`。
- 平台战绩问题进入 `player_query.rs`；客户端安装与启动进入 `software.rs`。
