# Steam Account Manager

## 0.6.1 5E 玩家数据查询

- 账号详情可验证 5E 主页 ID，并查询身份、段位、最近比赛后 ELO、KD、Rating、ADR、爆头率、胜率及最近 20 场比赛。
- 后端通过统一玩家查询接口适配 5E 网页数据服务；单场详情失败会保留其余结果，成功快照缓存 15 分钟，离线时可回退到过期缓存。
- 可选 Bearer Token 只存入 Windows 凭据管理器，不进入 SQLite、日志或导入导出；Token 失效时自动降级为匿名查询。

## 0.6.0 统一应用图标

- 桌面、开始菜单、任务栏、标题栏、侧栏、关于页和 favicon 统一使用同一套透明圆角图标。
- Windows 安装器和卸载器显式使用新 ICO；更新安装时仅重建用户原本已有的快捷方式，并通知 Shell 刷新图标缓存。

## 0.5.1 GitHub Release 一键更新

- 启动后静默检查 GitHub 最新 Release，发现新版时提供签名校验后的下载、安装和重启流程。
- NSIS 安装版支持原地更新；便携版可一键安装新版并转为当前用户安装版。
- 设置页提供手动检查、Release notes 和下载进度；更新失败不会影响账号管理功能。

## 0.4.2 品牌图标与安全说明

- 提亮应用图标，并统一用于 Windows 安装包、便携版、标题栏、侧栏和设置页。
- 设置页展示当前安装版本、GitHub 仓库及 Releases 入口，不会在后台请求 GitHub API。
- README 与设置页补充账号切换原理、凭据边界和封禁风险说明。

## 0.4.0 切号启动联动

- 未安装 CS2 时不再因配置部署失败而阻断切号，只启动 Steam。
- 已安装 CS2 时，切号并完成 Steam 登录确认后自动启动 CS2。
- 只启动目标 Steam 账号已关联且本机已安装的完美世界或 5E 平台，不再重启所有已配置平台。
- 平台页检测到软件已安装后，主按钮改为“启动软件”；未安装时继续提供下载或官网入口。

## 0.3.4 官方平台图标与 Edge 打开

- 平台列表改用 5E、完美世界竞技平台和 TeamSpeak 官网提供的品牌图标。
- 5E 下载页由后端优先直接启动 Edge，Edge 无法启动时回退到 Windows 系统浏览器。

## 0.3.3 标题栏与平台页修正

- 修复无边框窗口无法拖动，标题区域支持拖动和双击最大化。
- 5E 改为直接打开官方下载页；安装完成后立即清除临时进度状态。
- 平台软件使用功能图标并压缩重复说明，提高列表信息密度。

## 0.3.2 CS2 配置、平台软件与统一主题

- 新增独立“CS2 配置”页：可新建或导入多个 `.cfg` 方案、500 ms 自动保存、查看界面备注与最近历史，并为每个 Steam 账号选择要使用的方案。
- 切换账号前先把所选 CFG 复制到当前 CS2 安装目录并执行 SHA-256 校验，再无损合并该账号的 `+exec xxx.cfg` 启动参数；任一步失败都会中止切换并显示原因。
- 新增只读的 CS2 运行时配置预览，避免直接编辑可能被 Steam/CS2 回写的生成文件。官方资料整理见 `docs/cs2-configuration-files-official-research.md`。
- 新增独立“平台”页：集中检测完美世界、5E 与 TeamSpeak 3，完美世界和 TeamSpeak 3 支持官方下载进度、启动官方安装向导及退出后删除安装包；5E 因官网安全验证改用浏览器下载。
- 平台页的账号关联与 Steam 账号详情使用同一数据库来源；关联只在账号详情编辑，平台页同步汇总。
- 原生边框替换为主题适配标题栏，右侧画板按钮提供三套浅色、三套夜间主题；Steam 运行状态移回账号页。
- 备份、JSON 导入导出收纳到设置页底部折叠的“高级与恢复”区域。

## 0.3.1 平台与 CS2 cfg 一键检测

- 设置页新增“一键检测并配置”，显示完美世界、5E 启动程序及各 Steam 账号的 CS2 cfg 检测结果。
- 平台探测兼容常见安装目录下的多层客户端结构；自动检测失败时可手动选择启动程序。
- CS2 cfg 仅检测 `userdata\<账号>\730\local\cfg` 路径和配置文件数量，不修改配置内容。

## 0.3.0 中文安装向导与免安装版

- Windows NSIS 安装与卸载向导固定使用简体中文。
- GitHub Release 同时提供简体中文安装包和免安装 ZIP 包。

## 0.2.1 头像与平台自动联动
- 启动时自动检测完美世界竞技平台和 5E 客户端；切换 Steam 账号后重启已配置平台。
- 兼容 Steam 本地 PNG/JPEG 头像缓存并修复头像读取路径。

## 0.2.0 Steam 官方登录新增与账号详情

- “添加 Steam 账号”会安全重启 Steam，并等待用户在官方登录窗口登录；应用不读取或传递密码。
- 账号列表只展示 Steam 已记住的账号。无凭证账号会隐藏，但别名、备注、标签、平台关联和头像缓存继续保留。
- 账号详情与编辑合并为右侧抽屉，登录账号名仅在详情显示，SteamID64 不再进入界面。
- 标签支持多选快速筛选，账号必须同时满足全部已选标签。
- 移除手工 SteamID64 新增、不可用账号清理入口和账号标识色；导入只能更新已扫描过的账号。

## 0.1.2 账号资料与主题升级

- 从 Steam 本地 `config/avatarcache` 同步 PNG/JPEG 头像到应用专属缓存；源头像暂时缺失时保留最后一次缓存，不调用远程 API。
- 日常列表隐藏 Steam ID，以头像、昵称、是否在 Steam 登录列表、平台关联和标签为核心；Steam ID 仅保留在编辑资料的“高级信息”中。
- 使用完美世界、5E、FACEIT、其他和未关联作为平台筛选；旧手工分组仅为导入兼容保留，不再显示。
- 历史标签支持搜索、多选和按 Enter 新建；账号标识色限定为天蓝、青色、紫色、薄荷、珊瑚和琥珀。
- 提供极光蓝、脉冲紫、薄荷青和冰川白四套高对比主题，并在启动前恢复上次主题，避免闪烁。
- “未在 Steam 登录列表”的资料可单独或批量移除；清理只删除本应用中的别名、备注、标签关联、平台关联和头像缓存，不修改 Steam 文件。

头像缓存位于应用数据目录的 `avatars\`。WebView 的本地资源权限只允许访问这个目录，不允许直接读取 Steam 配置目录。

[![Windows CI](https://github.com/ahappymosquito/SteamAccountManager/actions/workflows/windows-ci.yml/badge.svg)](https://github.com/ahappymosquito/SteamAccountManager/actions/workflows/windows-ci.yml)
[![Release](https://img.shields.io/github/v/release/ahappymosquito/SteamAccountManager)](https://github.com/ahappymosquito/SteamAccountManager/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Steam Account Manager 是一个面向 Windows 10/11 x64 的本地 Steam 多账号资料管理与切换工具。它读取 Steam 官方客户端已经保存的账号列表，通过受控的注册表和 `loginusers.vdf` 修改切换本机仍然有效的登录状态。

> 本项目与 Valve、Steam、完美世界、5E、FACEIT 没有官方关联。Steam 客户端更新可能改变本地配置行为，请自行备份重要数据。

## 下载

从 [GitHub Releases](https://github.com/ahappymosquito/SteamAccountManager/releases/latest) 下载最新的 Windows x64 NSIS 安装包。当前安装包未进行商业代码签名，Windows SmartScreen 可能显示未知发布者提示；请核对 Release 页面提供的文件来源后再运行。

## 功能

- 启动时自动发现 Steam 安装目录，失败时也可手动配置
- 默认在启动时扫描 `config/loginusers.vdf`，按 SteamID64 同步账号
- 正确显示和搜索 UTF-8 中文登录名与个人昵称
- 管理别名、备注、收藏、标签和平台关联，并使用多标签精确筛选
- 通过 Steam 官方登录窗口添加账号，只展示已勾选“记住我”的账号
- 独立管理完美世界、5E 与 TeamSpeak 3 的安装检测和官方下载
- 管理多个 CS2 CFG 方案，并按 Steam 账号在切换前复制、校验和更新 `+exec` 启动参数
- 手工关联完美世界、5E、FACEIT 或其他平台账号
- 在账号详情验证 5E 主页 ID，并查看近期段位、比赛与聚合战绩
- 在明确确认后关闭 Steam、备份配置、切换账号并重新启动
- 判断本地确认、当前推测、Steam 未运行和未知状态
- 配置并直接启动第三方平台程序，不经过 shell
- JSON 资料导入导出、冲突预览和危险字段拦截
- 本地切换日志、脱敏登录名和最近 10 次配置备份

## 安全与隐私

本工具只处理 Steam 官方客户端已记住且本机仍有效的登录状态，不参与 Steam 账号认证。它不会保存 Steam 密码、Steam Guard 密钥、`shared_secret`、`identity_secret`、Cookie、Steam Session Token 或浏览器数据，不会模拟登录、绕过 Steam Guard、读取或修改进程内存、向 Steam 或游戏注入代码或干预反作弊系统。状态失效时，用户必须在 Steam 官方客户端完成登录或 Steam Guard 验证。

5E 玩家查询使用其非公开网页数据接口，可能随平台调整而失效。ELO 来自最近一场已完成比赛的 `origin_elo + change_elo`，界面明确标注为“最近比赛后 ELO”，不代表官方实时值。可选的 5E Bearer Token 仅保存在 Windows 凭据管理器，不写入 SQLite、日志、缓存、导入导出或错误文本；匿名查询仍可工作，401/403 时会保留凭据并自动降级。应用只缓存规范化结果，不保存平台原始 JSON。

日志不会记录完整注册表、完整 VDF 内容或认证数据。Steam 登录名在日志中默认脱敏。导入器递归拒绝包含 password、cookie、token、secret、Steam Guard 等危险键名的数据。

### 会不会导致 Steam 封禁？

现有实现不包含通常与作弊封禁相关的进程注入、内存修改、游戏自动化、认证绕过或反作弊干预。账号切换发生在 Steam 关闭后，只修改 Steam 官方客户端自身使用的本地注册表项和 `config/loginusers.vdf`，修改前创建备份，写入后重新校验，再由官方客户端正常启动。

因此，本工具的风险面与作弊程序不同。但本项目不是 Valve 官方产品，不能代表 Valve 对任何第三方工具作出“绝对不会封禁”的保证。Steam 客户端、本地配置格式或平台规则发生变化时，请暂停使用并查看 [GitHub Releases](https://github.com/ahappymosquito/SteamAccountManager/releases) 是否有兼容更新；涉及账号认证时，只在 Steam 官方客户端内操作。

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

最终的 NSIS 安装版与可直接运行的 Windows x64 便携版 EXE 均生成在项目根目录的 `release/`。明确发布时运行 `npm run package:release`，额外生成包含 README 和 LICENSE 的便携版 ZIP。`package:windows` 仍可用于只验证并生成底层 NSIS 构建结果。

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

## 数据与配置位置

应用通过 Tauri 的 `app_data_dir` 获取用户数据目录，通常位于 `%APPDATA%\com.steamaccountmanager.desktop\`。其中包含：

- `steam-account-manager.db`：SQLite 账号资料、设置和切换日志
- `cfg-library\`：应用管理的简洁 CFG 主文件
- `downloads\`：平台官方安装包临时目录；安装向导退出后自动删除安装包
- `backups\`：修改前的 VDF 与元数据备份，默认保留最近 10 次

应用不把数据库或备份放入 Steam 安装目录。

## 账号发现原理

应用启动时优先验证已保存的 Steam 路径；路径不存在或失效时，依次读取当前用户和本机的 Valve Steam 注册表项，检查 `SteamPath` 或 `InstallPath`，然后验证 `steam.exe` 和 `config\loginusers.vdf`。路径有效时会自动扫描账号和头像，同时从常见安装目录及 Windows 卸载注册表项检测完美世界竞技平台和 5E 客户端；已有平台配置不会被自动检测结果覆盖。VDF 解析器使用支持 UTF-8 中文名称的 tokenizer 和结构树，不使用正则粗暴解析；扫描时额外字段会被忽略但不会删除。

## 账号切换原理

切换目标始终由 SteamID64 定位，再读取对应 `AccountName`。流程会重新校验 VDF、请求 `steam.exe -shutdown` 正常退出；本机已安装 CS2 时，先复制所选 CFG 到 `game\csgo\cfg` 并校验 SHA-256，再只替换本应用此前管理的 `+exec` 参数，保留其他启动参数。通过后才创建安全备份，将目标账号设置为 `MostRecent=1` 和 `AllowAutoLogin=1`，写入注册表 `AutoLoginUser` 与 `RememberPassword`，最后重新启动 Steam；未安装 CS2 时跳过全部 CS2 配置步骤。Steam 登录确认成功后，已安装的 CS2 和目标账号有效关联的平台会一并启动。任一必要检查失败都会记录具体原因。

应用会在写入后以及 Steam 稳定启动后重新检查 VDF 和注册表。只有目标账号仍为唯一的最近账号、已记住密码并允许自动登录时才记录切换成功；如果 Steam 回写或清除了这些状态，应用会提示在官方客户端重新登录并勾选“记住我”。

“本地确认”只表示注册表、VDF、进程和最近切换结果一致，不代表 Steam 或任何第三方平台提供了官方验证。

## 备份和恢复

每次修改 Steam 配置前会在应用数据目录创建时间戳备份，包含 `loginusers.vdf`、目标 SteamID64、操作时间和切换前的注册表摘要。切换写入失败时自动尝试恢复 VDF。设置页可在二次确认后恢复最近一次备份。

## 常见错误

- **未找到 Steam**：在设置页手动选择包含 `steam.exe` 的安装目录。
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
