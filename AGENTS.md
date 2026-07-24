# Steam Account Manager 项目级交付约束

## Windows 双产物

- 任何改变应用行为、应用配置或项目版本的任务，在测试通过后都必须运行 `npm run package:release`。
- 任务完成时必须同时生成 NSIS 安装版和 Windows x64 便携版 ZIP，并复制到项目根目录的 `release/`。
- 安装版命名为 `Steam Account Manager_<version>_x64-setup.exe`；便携版命名为 `Steam-Account-Manager-<version>-windows-x64-portable.zip`。
- 交付前必须验证两个文件都存在、大小大于零，并报告绝对路径；缺少任一产物不得宣称任务完成。
- 纯文档、纯测试或用户当次明确要求跳过打包的任务可不生成产物；用户当前提示词始终优先。
- 本地构建产物不自动推送、发布或提交到 Git；这些外部操作仍需用户当次明确授权。
