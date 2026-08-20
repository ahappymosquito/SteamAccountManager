# Steam Account Manager

[![Windows CI](https://github.com/ahappymosquito/SteamAccountManager/actions/workflows/windows-ci.yml/badge.svg)](https://github.com/ahappymosquito/SteamAccountManager/actions/workflows/windows-ci.yml)
[![Release](https://img.shields.io/github/v/release/ahappymosquito/SteamAccountManager)](https://github.com/ahappymosquito/SteamAccountManager/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Steam Account Manager 是一个面向 Windows 10/11 x64 的本地 Steam 多账号资料管理与切换工具。它读取 Steam 官方客户端已经保存的账号列表，通过受控的注册表和 `loginusers.vdf` 修改，切换本机仍然有效的登录状态。

> 本项目与 Valve、Steam、完美世界、5E、FACEIT 没有官方关联。Steam 客户端更新可能改变本地配置行为，请自行备份重要数据。

各版本变更见 [`release/CHANGELOG.md`](release/CHANGELOG.md)。

## 下载

从 [GitHub Releases](https://github.com/ahappymosquito/SteamAccountManager/releases/latest) 下载最新的 Windows x64 NSIS 安装包。当前安装包未进行商业代码签名，Windows SmartScreen 可能显示未知发布者提示；请核对 Release 页面提供的文件来源后再运行。

本地构建时，安装版和便携版会复制到项目根目录的 [`release/`](release/)。

## 功能

- 启动时自动发现 Steam 安装目录，失败时也可手动配置
- 默认在启动时扫描 `config/loginusers.vdf`，按 SteamID64 同步账号；首页每 10 秒静默刷新本机状态
- 正确显示和搜索 UTF-8 中文登录名与个人昵称
- 列表以 Steam 头像、头像框和昵称为主身份，支持别名、备注、收藏、标签和自定义拖拽顺序
- 通过 Steam 官方登录窗口添加账号，只展示已勾选“记住我”的账号
- 独立管理 Steam、完美世界、5E 与 TeamSpeak 3 的安装检测、路径配置和启动
- 通过可视化/源码双视图管理多个 CS2 CFG 方案，预览与复制准星并导出 CFG；切号前按账号复制、校验和更新 `+exec` 启动参数
- 手工关联完美世界、5E、FACEIT 或其他平台账号；完美平台可按 SteamID64 自动匹配
- 在账号详情验证 5E 玩家名称、主页 ID 或完整主页链接，并查看近期段位、比赛与聚合战绩
- 账号页列表顶端默认「只切 Steam」；关闭后才会在 Steam 就绪时启动该账号已关联且本机已配置的 5E / 完美平台
- 判断本地确认、当前推测、Steam 未运行和未知状态，本地确认优先显示 Steam 中文昵称
- 明文 JSON 文件备份、分类恢复、覆盖前内部快照和事务恢复
- 本地切换日志、脱敏登录名和最近 10 次配置备份
- 左侧栏显示当前版本；启动后与每 6 小时静默检查更新，点更新即可从 `cdn.qrqto.club` 下载、安装并自动重启

## 安全与隐私

本工具只处理 Steam 官方客户端已记住且本机仍有效的登录状态，不参与 Steam 账号认证。它不会保存 Steam 密码、Steam Guard 密钥、`shared_secret`、`identity_secret`、Cookie、Steam Session Token 或浏览器数据，不会模拟登录、绕过 Steam Guard、读取或修改进程内存、向 Steam 或游戏注入代码或干预反作弊系统。状态失效时，用户必须在 Steam 官方客户端完成登录或 Steam Guard 验证。

用户可为完美平台和 5E 手工保存平台登录账号、明文密码和备注，方便复制后自行登录及完成短信验证。此密码不加密、不用于自动登录，并会进入用户主动导出的明文 `.sam-backup.json` 文件；请按普通明文文件管理。5E Bearer Token 与完美 Access Token 仍只保存在 Windows 凭据管理器，不进入数据库或备份。

5E 玩家查询使用其非公开网页数据接口，可能随平台调整而失效。已定级 ELO 来自最近一条有效天梯比赛摘要，使用同一记录的 `origin_elo + change_elo`，界面明确标注为“最近比赛后 ELO”，不代表官方实时值。定级中只展示已打场次，上赛季分数仅用于排序参考，不冒充当前 ELO。可选的 5E Bearer Token 仅保存在 Windows 凭据管理器，不写入 SQLite、日志、缓存、导入导出或错误文本；匿名查询仍可工作，401/403 时会保留凭据并自动降级。应用只缓存规范化结果，不保存平台原始 JSON。

完美平台同样使用非公开网页接口。SteamID64 可直接作为目标玩家标识，但查询需要 Access Token；应用只读取无需私有 signer 的赛季记录接口，分数标注为“赛季记录分数”，不承诺实时性。Token 与 5E 凭据隔离存放于 Windows 凭据管理器，未配置时不会发起完美平台玩家查询。接口研究与字段边界见 `docs/perfect-world-player-query-research.md`。

日志不会记录完整注册表、完整 VDF 内容、平台密码或认证数据。Steam 登录名在日志中默认脱敏。软件备份只允许版本化白名单业务表，查询 Token、Cookie、Steam Guard 数据、玩家缓存和切换日志不会导出。

### 会不会导致 Steam 封禁？

现有实现不包含通常与作弊封禁相关的进程注入、内存修改、游戏自动化、认证绕过或反作弊干预。账号切换发生在 Steam 关闭后，只修改 Steam 官方客户端自身使用的本地注册表项和 `config/loginusers.vdf`，修改前创建备份，写入后重新校验，再由官方客户端正常启动。

因此，本工具的风险面与作弊程序不同。但本项目不是 Valve 官方产品，不能代表 Valve 对任何第三方工具作出“绝对不会封禁”的保证。Steam 客户端、本地配置格式或平台规则发生变化时，请暂停使用并查看 [GitHub Releases](https://github.com/ahappymosquito/SteamAccountManager/releases) 是否有兼容更新；涉及账号认证时，只在 Steam 官方客户端内操作。

## 工作方式

### 账号发现

应用启动时优先验证已保存的 Steam 路径；路径不存在或失效时，依次读取当前用户和本机的 Valve Steam 注册表项，检查 `SteamPath` 或 `InstallPath`，然后验证 `steam.exe` 和 `config\loginusers.vdf`。路径有效时会自动扫描账号和头像，同时从常见安装目录及 Windows 卸载注册表项检测完美世界竞技平台、5E 与 TeamSpeak 3；已有平台配置不会被自动检测结果覆盖。VDF 解析器使用支持 UTF-8 中文名称的 tokenizer 和结构树，不使用正则粗暴解析；扫描时额外字段会被忽略但不会删除。

头像采用两级来源：本机 Steam 头像缓存用于轻量离线扫描；启动与手动扫描可从公开 Steam 社区资料补充动态头像和头像框。静态 JPG/PNG 与 GIF、动态 WebP、APNG 均保持原始文件，写入应用专属 `avatars\` 缓存。WebView 只允许访问该目录，不允许直接读取 Steam 配置目录。

### 账号切换

切换目标始终由 SteamID64 定位，再读取对应 `AccountName`。流程会重新校验 VDF、请求 `steam.exe -shutdown` 正常退出；本机已安装 CS2 时，先复制所选 CFG 到 `game\csgo\cfg` 并校验 SHA-256，再只替换本应用此前管理的 `+exec` 参数，保留其他启动参数。通过后才创建安全备份，将目标账号设置为 `MostRecent=1` 和 `AllowAutoLogin=1`，写入注册表 `AutoLoginUser` 与 `RememberPassword`，最后重新启动 Steam；未安装 CS2 时跳过全部 CS2 配置步骤。应用不会自动启动 CS2。

账号页「只切 Steam」默认打开，此时不启动第三方平台。关闭该开关后，若目标账号关联且本机已配置 5E，则在 Steam 切换完成后读取注册表 `ActiveProcess\ActiveUser`，精确匹配目标账号并等待服务稳定后再启动 5E；信号不可用时最多等待 10 秒后兼容启动，明确检测到其他账号时则阻止 5E。已经运行时，只结束配置安装目录内且名称属于 5E 白名单的进程，再重新启动。若同时关联且已配置完美平台，则在 Steam 就绪后启动或重启完美。5E 或完美未配置、退出超时或启动失败会作为警告记录，不回滚已成功的 Steam 切换；必要的 Steam 检查失败仍会中止并记录具体原因。

应用会在写入后以及 Steam 稳定启动后重新检查 VDF 和注册表。只有目标账号仍为唯一的最近账号、已记住密码并允许自动登录时才记录切换成功；如果 Steam 回写或清除了这些状态，应用会提示在官方客户端重新登录并勾选“记住我”。

“本地确认”只表示注册表、VDF、进程和最近切换结果一致，显示名称优先使用 `loginusers.vdf` 中的 Steam 昵称；它不代表 Steam 或任何第三方平台提供了官方验证。

### 5E 与完美平台查询

这里的“用户名”是 **5E 玩家名称**，不是 Steam 登录账号、Steam 昵称或本应用中的自定义别名。完美平台也不使用用户名查询，它使用账号扫描时得到的 17 位 SteamID64 自动匹配。

1. **解析玩家输入**  
   用户可以填写 5E 玩家名称、数字主页 ID，或 `5eplay.com` 下的完整玩家主页链接。数字 ID 和主页链接会直接提取为 5E `domain`。玩家名称只接受完全一致的结果；找不到区分大小写的完全匹配时，只接受唯一的大小写不敏感匹配，不采用模糊搜索。
2. **转换为内部玩家 ID**  
   通过 5E `idTransfer` 将 `domain` 转为稳定 `uuid`。平台关联中保存规范化后的 `domain`，便于再次查询。
3. **读取身份、比赛和段位**  
   玩家资料来自 `header` 接口。比赛列表来自最近 180 天、最多 20 场 CS2 比赛。应用按列表顺序选择最新有效天梯记录，并结合 `level_type` 与 `match_status` 排除 1v1、识别定级状态。已定级时，“最近比赛后 ELO”取同一记录的 `origin_elo + change_elo`；定级中不显示临时 ELO，只显示已打场次。
4. **读取每场比赛详情**  
   最多 3 场一组并发读取。每场规范化为地图、时间、胜负、比分、击杀/死亡/助攻、Rating、ADR、爆头率以及赛前、变化和赛后 ELO。基础详情缺少 Rating 或 ADR 且已配置有效 5E Token 时，会尝试读取高级比赛数据补充。Token 不是普通查询的必需条件。
5. **聚合近期表现**  
   KD、胜率、爆头率、Rating 和 ADR 只基于成功读取的场次。单场失败不会让整个查询失败。

成功快照写入本地 SQLite，不保存平台原始 JSON。应用启动后刷新全部已填写玩家标识的 5E 关联，之后每 15 分钟批量刷新。打开账号详情时直接显示最近缓存；缓存超过 15 分钟会标记为“缓存数据”。手动刷新可跳过缓存。网络失败且存在旧缓存时保留旧数据。Token 遇到 `401/403` 时自动降级为匿名查询。

完美平台直接使用 SteamID64 作为目标 `uid`，并携带用户配置的 Access Token 请求玩家资料和赛季天梯记录。当前只展示赛季记录中的段位和分数，不查询近期比赛，因此界面标注为“赛季记录分数”。

## 数据与配置位置

应用通过 Tauri 的 `app_data_dir` 获取用户数据目录，通常位于 `%APPDATA%\com.steamaccountmanager.desktop\`。其中包含：

- `steam-account-manager.db`：SQLite 账号资料、设置和切换日志
- `cfg-library\`：应用管理的简洁 CFG 主文件
- `downloads\`：平台官方安装包临时目录；安装向导退出后自动删除安装包
- `backups\`：修改前的 VDF 与元数据备份，默认保留最近 10 次；`import-before-restore\` 保存软件资料恢复前的内部 JSON 快照
- `avatars\`：应用专属头像与头像框缓存

应用不把数据库或备份放入 Steam 安装目录。

## 备份和恢复

每次修改 Steam 配置前会在应用数据目录创建时间戳备份，包含 `loginusers.vdf`、目标 SteamID64、操作时间和切换前的注册表摘要。切换写入失败时自动尝试恢复 VDF。设置页可在二次确认后恢复最近一次备份。

软件备份为明文 JSON。恢复前先在应用数据目录静默保存当前资料，再按用户勾选的分类事务覆盖。账号类数据只按 SteamID64 恢复到本机当前可用账号。

## 常见错误

- **未找到 Steam**：在平台页手动选择包含 `steam.exe` 的安装目录。
- **账号不可切换**：先在 Steam 官方客户端登录并勾选记住登录状态。
- **Steam 退出超时**：等待 Steam 完成更新或游戏退出，再重试。
- **原生构建失败**：确认 Visual Studio C++ Build Tools 和 Windows SDK 已安装。
- **自动登录状态未保留**：Steam 已回写或清除本地状态，请在 Steam 官方客户端重新登录并勾选“记住我”。
- **登录验证出现**：本地凭据、Steam Guard 授权或服务端令牌已失效，必须在 Steam 官方客户端完成验证；应用不会读取或传递密码。

## 已知限制

- 首版只支持 Windows x64 和 NSIS 安装包。
- 第三方平台关联完全由用户手工录入，不读取其当前登录账号。
- Steam 客户端未来更新可能改变注册表或 VDF 格式。
- 应用无法保证 Steam 记住的登录状态仍被服务端接受。

## 文档

- [`PRODUCT.md`](PRODUCT.md)：产品目标、用户场景与界面原则
- [`DESIGN.md`](DESIGN.md)：视觉与设计系统
- [`docs/project-structure.md`](docs/project-structure.md)：模块边界与调用链
- [`release/CHANGELOG.md`](release/CHANGELOG.md)：版本更新日志

## 技术栈

Tauri 2、Rust、React、TypeScript、Vite、SQLite、Tailwind 风格原生 CSS tokens、Radix Primitives、Zustand、React Hook Form 和 Zod。

## 系统和开发环境

- Windows 10 或 Windows 11 x64
- Microsoft Edge WebView2 Runtime
- Node.js 20 或更高版本、npm 10 或更高版本
- Rust stable，目标 `x86_64-pc-windows-msvc`
- Visual Studio 2022 Build Tools，勾选“使用 C++ 的桌面开发”和 Windows SDK

## 安装与开发运行

```powershell
cmd /c npm install
cmd /c npm run tauri dev
```

仅运行前端预览：

```powershell
cmd /c npm run dev
```

## 生产构建

```powershell
cmd /c npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
cmd /c npm run tauri build
```

也可以用一条命令完成测试、静态检查、本地 NSIS 打包和便携 EXE 复制：

```powershell
cmd /c npm run package:local
```

最终的 NSIS 安装版与可直接运行的 Windows x64 便携版 EXE 均生成在项目根目录的 `release/`。每次打包前，根目录中的旧安装包和压缩包会移动到 `release/history/`，`release/CHANGELOG.md` 会保留在原地。明确发布时运行 `npm run package:release`，额外生成包含 README、LICENSE 和更新日志的便携版 ZIP。`package:windows` 仍可用于只验证并生成底层 NSIS 构建结果。

## GitHub 自动发布

main 分支和 Pull Request 会在 GitHub Windows Runner 上完成测试与 NSIS 构建，安装包作为 Actions Artifact 保留 14 天。创建与应用版本一致的标签（例如 `v0.1.3`）并推送后，发布工作流会自动创建 GitHub Release 并上传安装包。

自动更新发布还需要在仓库的 Actions Secrets 中配置：

- `TAURI_SIGNING_PRIVATE_KEY`：`%USERPROFILE%\.tauri\steam-account-manager-updater.key` 的完整内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：`%USERPROFILE%\.tauri\steam-account-manager-updater.password.txt` 的完整内容。

私钥和密码不得提交到 Git，必须离线备份。Release 工作流会生成并上传签名、`latest.json` 和 NSIS 更新资产；缺少任一 Secret 时会在构建发布包前停止。

```powershell
git tag v0.1.3
git push origin v0.1.3
```
