# Steam Account Manager

## 0.1.3 Steam 官方登录新增与账号详情

- “添加 Steam 账号”会安全重启 Steam，并等待用户在官方登录窗口登录；应用不读取或传递密码。
- 账号列表只展示 Steam 已记住的账号。无凭证账号会隐藏，但别名、备注、标签、平台关联和头像缓存继续保留。
- 账号详情与编辑合并为右侧抽屉，登录账号名仅在详情显示，SteamID64 不再进入界面。
- 标签支持多选快速筛选，账号必须同时满足全部已选标签。
- 移除手工 SteamID64 新增、不可用账号清理入口和账号标识色；导入只能更新已扫描过的账号。

## 0.1.2 账号资料与主题升级

- 从 Steam 本地 `config/avatarcache` 同步头像到应用专属缓存；源头像暂时缺失时保留最后一次缓存，不调用远程 API。
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
- 手工关联完美世界、5E、FACEIT 或其他平台账号
- 在明确确认后关闭 Steam、备份配置、切换账号并重新启动
- 判断本地确认、当前推测、Steam 未运行和未知状态
- 配置并直接启动第三方平台程序，不经过 shell
- JSON 资料导入导出、冲突预览和危险字段拦截
- 本地切换日志、脱敏登录名和最近 10 次配置备份

## 安全与隐私

本工具不会保存 Steam 密码、Steam Guard 密钥、`shared_secret`、`identity_secret`、Cookie、Session Token 或浏览器数据，不会模拟登录、绕过 Steam Guard、读取进程内存、注入客户端或调用第三方私有 API。它只能切换 Steam 已经记住且本机仍有效的登录状态；状态失效时，用户必须在 Steam 官方客户端完成登录或 Steam Guard 验证。

日志不会记录完整注册表、完整 VDF 内容或认证数据。Steam 登录名在日志中默认脱敏。导入器递归拒绝包含 password、cookie、token、secret、Steam Guard 等危险键名的数据。

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

也可以用一条命令完成测试、静态检查和本地 NSIS 打包：

```powershell
cmd /c npm run package:windows
```

NSIS 安装包生成在 `src-tauri/target/release/bundle/nsis/`。

## GitHub 自动发布

main 分支和 Pull Request 会在 GitHub Windows Runner 上完成测试与 NSIS 构建，安装包作为 Actions Artifact 保留 14 天。创建与应用版本一致的标签（例如 `v0.1.3`）并推送后，发布工作流会自动创建 GitHub Release 并上传安装包。

```powershell
git tag v0.1.3
git push origin v0.1.3
```

## 数据与配置位置

应用通过 Tauri 的 `app_data_dir` 获取用户数据目录，通常位于 `%APPDATA%\com.steamaccountmanager.desktop\`。其中包含：

- `steam-account-manager.db`：SQLite 账号资料、设置和切换日志
- `backups\`：修改前的 VDF 与元数据备份，默认保留最近 10 次

应用不把数据库或备份放入 Steam 安装目录。

## 账号发现原理

应用启动时优先验证已保存的 Steam 路径；路径不存在或失效时，依次读取当前用户和本机的 Valve Steam 注册表项，检查 `SteamPath` 或 `InstallPath`，然后验证 `steam.exe` 和 `config\loginusers.vdf`。路径有效时会自动扫描账号和头像。VDF 解析器使用支持 UTF-8 中文名称的 tokenizer 和结构树，不使用正则粗暴解析；扫描时额外字段会被忽略但不会删除。

## 账号切换原理

切换目标始终由 SteamID64 定位，再读取对应 `AccountName`。流程会重新校验 VDF、请求 `steam.exe -shutdown` 正常退出、创建备份，将目标账号设置为 `MostRecent=1` 和 `AllowAutoLogin=1`，写入注册表 `AutoLoginUser` 与 `RememberPassword`，最后重新启动 Steam。缺失字段会无损插入，其他账号和未知 VDF 字段保持不变。正常退出超时不会默认强制结束 `steamservice.exe`。

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
