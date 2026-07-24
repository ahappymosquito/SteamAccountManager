# Steam Account Manager 项目级交付约束

## Windows 双产物

- 每次修改源码、应用配置、构建脚本或依赖后，在测试通过后都必须自动运行 `npm run package:local`，无需另行询问用户。
- 日常测试交付必须同时生成 NSIS 安装版和可直接运行的 Windows x64 便携版 EXE，并复制到项目根目录的 `release/`。
- 安装版命名为 `Steam Account Manager_<version>_x64-setup.exe`；本地测试便携版命名为 `Steam-Account-Manager-<version>-portable.exe`。
- 交付前必须验证两个文件都存在、大小大于零，并报告绝对路径；缺少任一产物不得宣称任务完成。
- 仅修改说明文档或项目协作规则、且不改变源码、配置、构建脚本、依赖或版本时，可以不重新构建；用户当前提示词始终优先。

## GitHub 外部操作

- 本地构建安装版和便携版属于默认交付步骤，不代表发布，不需要用户额外授权。
- 只有用户当次明确要求发布时，才运行 `npm run package:release` 额外生成 `Steam-Account-Manager-<version>-windows-x64-portable.zip`。
- 推送 GitHub、创建或推送 Git Tag、创建 GitHub Release、上传 Release 资产，都必须由用户当次明确要求；不得从“构建”“完成”或“供测试”等措辞推断授权。
- `release/` 中的本地产物不自动提交到 Git，也不自动上传到任何远程服务。
