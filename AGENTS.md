# Steam Account Manager 项目级交付约束

## Windows 双产物

- 每次修改源码、应用配置、构建脚本或依赖后，在测试通过后都必须自动运行 `npm run package:local`，无需另行询问用户。
- 日常测试交付必须同时生成 NSIS 安装版和可直接运行的 Windows x64 便携版 EXE，并复制到项目根目录的 `release/`。
- 安装版命名为 `Steam Account Manager_<version>_x64-setup.exe`；本地测试便携版命名为 `Steam-Account-Manager-<version>-portable.exe`。
- 交付前必须验证两个文件都存在、大小大于零，并报告绝对路径；缺少任一产物不得宣称任务完成。
- `package:local` / `package:release` 在产物已复制到 `release/` 并校验通过后，必须删除 `src-tauri/target` 和项目根 `dist`，避免构建中间文件占盘。不删除 `release/`、`release/history/`、`release/CHANGELOG.md`、`node_modules` 或源码。删除失败只警告，不让已经成功的交付失败。
- `release/CHANGELOG.md` 是版本更新日志，随仓库提交。打包时只把旧的 `.exe` / `.zip` 移入 `history/`，不得归档或删除该文件。
- 仅修改说明文档或项目协作规则、且不改变源码、配置、构建脚本、依赖或版本时，可以不重新构建；用户当前提示词始终优先。

## GitHub 外部操作

- 本地构建安装版和便携版属于默认交付步骤。CDN 上传随 `package:local` 进行。
- **大更新自动推送并发布**，由代理判断时机，测试通过且 `release/` 产物齐全后再执行，无需当次再问。
- 大更新：面向用户的功能、安装/运行时依赖、更新通道、可见行为变化。文档、协作规则、测试、注释等小改动不单独推送，可随下一次大更新一起推。
- 发布动作：`git push origin main`、附注版本 Git Tag（`v<version>`）、GitHub Release、上传 NSIS 安装包和 `Steam-Account-Manager-<version>-windows-x64-portable.zip`。已有合格 `release/` 产物时，可直接打 zip，不必为发版再跑一遍完整构建。
- `release/` 中的本地产物不提交到 Git。
