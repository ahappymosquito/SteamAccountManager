# CS2 配置文件：Valve 一手资料核查

> 核查日期：2026-07-23  
> 范围：Counter-Strike 2 客户端的账号配置发现、预览和编辑安全边界。仅采用 Valve/Steam 官方页面、Valve Developer Community（VDC）和官方游戏运行时文件作为权威来源。

## 结论

1. Valve 官方资料能确认账号范围目录的通用结构：Steam Cloud 本地根目录下先按 Steam 账号 ID、再按 AppID 分隔。CS2 的官方 AppID 是 `730`，所以账号范围根目录可确定为：

   ```text
   <Steam>/userdata/<accountID>/730/
   ```

   Windows 默认 Steam Cloud 根目录是 `C:\Program Files (x86)\Steam\userdata`；macOS 和 Linux 默认根目录分别是 `~/Library/Application Support/Steam/userdata`、`~/.local/share/Steam/userdata`。[Steam Support：Steam Cloud](https://help.steampowered.com/en/faqs/view/68D2-35AB-09A9-7678)；[Counter-Strike 2 官方商店页（AppID 730）](https://store.steampowered.com/app/730/CounterStrike_2/)

2. Valve 的公开文档没有逐项列出或稳定性承诺 CS2 当前客户端生成的文件名、`_0_slot0` 含义、`local/cfg` 子目录结构或每个文件的字段归属。因此，应用不能把任何文件名当作永久 API；应在实际账号目录中枚举、分类和验证。

3. 当前 CS2 安装中需要识别的运行时候选文件通常是：

   ```text
   <Steam>/userdata/<accountID>/730/local/cfg/
     cs2_user_convars_0_slot0.vcfg
     cs2_user_keys_0_slot0.vcfg
     cs2_machine_convars.vcfg
     cs2_video.txt
   ```

   这些名称是当前运行时发现目标，不是 Valve 公布的兼容性契约。本次环境没有已安装 CS2 的官方文件样本可供独立核验，故实现必须以“文件实际存在且内容通过验证”为准，并允许未来出现其他 slot、后缀或文件名。

4. 只读预览上述已发现文件通常是最低风险操作。直接编辑游戏生成的 `cs2_user_*.vcfg` 有被游戏退出写回或 Steam Cloud 同步覆盖的风险；`cs2_machine_convars.vcfg` 和 `cs2_video.txt` 应默认只读。需要持久化用户自定义命令时，优先管理用户自建的 `autoexec.cfg`，并通过已安装游戏清单解析实际安装目录，而不是硬编码路径。

## 官方可证事实

### 账号与路径

Steam Support 明确说明：

- `userdata` 下的目录对应曾在该机器登录过的 Steam 账号；
- 每个账号目录下再按游戏 AppID 分隔；
- Steam Cloud 活动记录在 `<Steam>/logs/cloud_log.txt`。

结合官方 CS2 商店页的 AppID `730`，可安全推导 `<Steam>/userdata/<accountID>/730/` 是 CS2 的账号范围目录。[Steam Support：Steam Cloud](https://help.steampowered.com/en/faqs/view/68D2-35AB-09A9-7678)

Steam Support 并未说明 `userdata` 目录名一定是 SteamID64。面向用户展示时应称其为 Steam 账号 ID/账号目录名；若需要映射身份，应从 Steam 本地账号元数据验证，不能仅凭目录名猜测。

### Steam Cloud 的读写与覆盖时机

Steamworks 文档说明，Steam Cloud 会在应用会话前后同步：启动前下载，退出后上传会话中改变的匹配文件；Steam 客户端负责保持多台设备同步。Steam Support 还说明本地与云端不一致时可能出现冲突选择界面。[Steamworks：Steam Cloud](https://partner.steamgames.com/doc/features/cloud)；[Steam Support：Steam Cloud](https://help.steampowered.com/en/faqs/view/68D2-35AB-09A9-7678)

由此得到直接的产品约束：

- 游戏运行中修改文件可能与游戏自身写回竞争；
- 游戏退出后立即修改可能与 Cloud 上传竞争；
- 其他设备或云端版本可能在下次启动前覆盖本地修改；
- 修改前应记录文件时间戳和内容哈希，写入前再次检查，并保留可恢复备份。

Steamworks 还明确建议不要把视频质量等机器专属设置作为跨设备 Cloud 配置。这支持将机器/视频配置默认设为只读，但不能反向证明 CS2 对某个具体文件采用了何种 Cloud 规则。[Steamworks：Steam Cloud](https://partner.steamgames.com/doc/features/cloud)

### 游戏自身写回

VDC 的引擎通用文档说明：带 `FCVAR_ARCHIVE` 标志的 ConVar 会在游戏关闭或手动执行 `host_writeconfig` 时写入用户配置，并在下次启动时恢复。该文档使用 Source 时代的 `config.cfg` 名称，因此它证明的是写回机制，不证明 CS2 当前具体输出文件名。[VDC：Developer Console Control](https://developer.valvesoftware.com/wiki/DevMsg)

应用应假设 CS2 的游戏生成配置可能在运行期间、执行保存命令时或退出时被整体重新序列化。不要依赖原始键顺序、空白、引号风格或注释能被保留。

## 文件类别、格式与安全策略

| 文件/类别 | 已知格式与用途边界 | 预览 | 编辑策略 |
|---|---|---:|---|
| `cs2_user_convars_0_slot0.vcfg` | 当前运行时候选名；通常承载用户 ConVar。Valve 未公开其完整 schema 或 slot 语义。 | 可以，只读、限大小、按文本展示 | 高级功能；仅在确认游戏和相关写回进程已退出后，备份并做并发检查 |
| `cs2_user_keys_0_slot0.vcfg` | 当前运行时候选名；通常承载按键绑定。Valve 未公开其完整 schema 或 slot 语义。 | 可以，只读、限大小、按文本展示 | 与 user convars 相同；不能假定只有 `slot0` |
| `cs2_machine_convars.vcfg` | 当前运行时候选名；名称表明机器范围，但 Valve 未公开字段契约。 | 可以，只读 | 默认禁止编辑或跨账号复制 |
| `cs2_video.txt` | 当前运行时候选名；Valve 未公开当前 CS2 schema。 | 可以，只读 | 默认禁止编辑或跨机器复制 |
| 用户自建 `autoexec.cfg` | CFG 是按顺序执行控制台命令的脚本类别；`exec`/自动执行模式见 VDC。 | 可以 | 首选的受控自定义入口；创建前解析并验证实际 CS2 安装目录 |
| Valve 随游戏分发的默认/游戏模式配置 | 属于游戏内容，更新时可能被替换。 | 可以 | 不应修改；使用用户覆盖文件 |
| `steam_autocloud.vdf`、Cloud 状态/备份衍生文件 | Steamworks 明确说 `steam_autocloud.vdf` 由 Steam 创建、游戏可忽略。其他衍生文件也不应当作主配置。 | 仅诊断 | 不编辑 |

Source 2 的 `.vcfg` 属于配置文件家族；VDC 的 Source 2 移植说明称部分 `.vcfg` 是从旧 `.cfg` 改名而来。[VDC：Porting Legacy Content](https://developer.valvesoftware.com/wiki/Source_2/Docs/Porting_Legacy_Content)；[VDC：VCFG](https://developer.valvesoftware.com/wiki/VCFG)

但这不足以证明 CS2 用户 `.vcfg` 使用 KV1、KV3 或某个公开且稳定的 schema。实现不应：

- 把 `.vcfg` 当作逐行 CFG 命令脚本；
- 给它强加 KV3 header；
- 忽略重复键、未知块或未来字段；
- 解析后全量重排并覆盖原文件。

若必须结构化修改，解析器应保留未知内容，并先用真实游戏生成样本做回读验证；无法无损处理时应拒绝写入。

## 注释支持

VDC 的 CFG 示例明确使用 `//` 单行注释，CS 系服务器配置文档也给出 `convar value // optional comment` 的形式。[VDC：CS:GO Dedicated Servers](https://developer.valvesoftware.com/wiki/Counter-Strike%3A_Global_Offensive/Dedicated_Servers)

VDC 的 KeyValues 文档同样记录了 C++ 风格单行注释，同时警告解析实现存在细节差异且不支持块注释。[VDC：KeyValues](https://developer.valvesoftware.com/wiki/KeyValues)

这些资料不能证明：

- 当前 CS2 的每一种用户 `.vcfg` 都使用同一个 KeyValues 解析器；
- `/* ... */` 可用于 CS2 用户配置；
- 游戏重新保存 `.vcfg` 时会保留任何注释。

因此：

- 对用户自建 `.cfg`，只使用 `//` 单行注释；
- 对游戏生成 `.vcfg`，不要写入依赖注释保存的元数据；
- 应预期游戏写回后注释、空白和顺序消失。

## 推荐实现边界

### 发现

1. 先解析实际 Steam 安装位置，不假定 `C:` 或默认目录。
2. 枚举 `<Steam>/userdata/*/730/`。
3. 优先检查 `local/cfg`，但把它视为当前布局而非永久规则。
4. 枚举实际存在的普通文件；用 allowlist 做分类展示，但不要因此漏掉未来的 `cs2_user_*_slot*.vcfg`。
5. 拒绝跟随逃出账号目录的链接或重解析点；限制单文件大小。

### 预览

- 默认只读；
- 显示相对路径、大小、修改时间和内容哈希；
- UI 中遮蔽账号 ID；
- 对非文本、超大、解析失败或含异常编码的文件只显示元数据；
- 不因“预览”触发格式化、换行转换或 Cloud 操作。

### 写入

只有满足以下条件才允许编辑游戏生成文件：

1. CS2 与 Steam 的相关写回/同步状态已确认安全；
2. 写入前已有同目录外的可恢复备份；
3. 读取时的路径、文件标识、大小、mtime 和哈希在写入前仍匹配；
4. 在同一卷创建临时文件，完整落盘后原子替换；
5. 保留原编码和换行；
6. 写后重新读取并验证；
7. 明确告知用户 Steam Cloud 或游戏下次运行仍可能覆盖修改。

默认产品策略应是：

- `autoexec.cfg`：可编辑；
- `cs2_user_*.vcfg`：高级、受保护编辑；
- `cs2_machine_convars.vcfg`、`cs2_video.txt`：只读；
- Valve 分发文件、Cloud 元数据和备份衍生文件：禁止编辑。

## 证据缺口与验证办法

Valve 的公开页面目前没有提供以下保证：

- CS2 当前所有客户端配置文件的完整名单；
- `cs2_user_convars_0_slot0.vcfg`、`cs2_user_keys_0_slot0.vcfg` 等名称的长期稳定性；
- `_0_slot0` 的公开语义；
- 每个文件的完整字段归属；
- 用户 `.vcfg` 的正式 schema、编码、注释和序列化保留规则；
- CS2 对每个文件的精确 Steam Cloud include/exclude 配置。

发布写入功能前，应在每个受支持平台用当前官方 CS2 构建做可复现验证：

1. 记录游戏关闭状态下的账号配置目录清单和哈希；
2. 启动游戏，分别改变按键、普通设置和视频设置；
3. 正常退出，比较创建/修改/删除的文件及内容；
4. 执行 `host_writeconfig` 后重复比较；
5. 检查 `<Steam>/logs/cloud_log.txt` 的同步记录；
6. 在另一台设备验证 Cloud 下载和冲突行为；
7. 更新 CS2 后重复测试，避免把观察到的文件名升级成未经证实的兼容性承诺。

## 一手资料

- [Counter-Strike 2 官方 Steam 商店页（AppID 730）](https://store.steampowered.com/app/730/CounterStrike_2/)
- [Steam Support：Steam Cloud](https://help.steampowered.com/en/faqs/view/68D2-35AB-09A9-7678)
- [Steamworks Documentation：Steam Cloud](https://partner.steamgames.com/doc/features/cloud)
- [Steamworks Documentation：ISteamRemoteStorage](https://partner.steamgames.com/doc/api/isteamremotestorage)
- [Valve Developer Community：Developer Console Control](https://developer.valvesoftware.com/wiki/DevMsg)
- [Valve Developer Community：VCFG](https://developer.valvesoftware.com/wiki/VCFG)
- [Valve Developer Community：Porting Legacy Content](https://developer.valvesoftware.com/wiki/Source_2/Docs/Porting_Legacy_Content)
- [Valve Developer Community：KeyValues](https://developer.valvesoftware.com/wiki/KeyValues)
- [Valve Developer Community：CS:GO Dedicated Servers](https://developer.valvesoftware.com/wiki/Counter-Strike%3A_Global_Offensive/Dedicated_Servers)

