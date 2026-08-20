/** Lossless CS2 CFG parsing, current-command comments, and targeted text mutation. */

export type CfgSectionId =
  | "crosshair"
  | "audio"
  | "binds"
  | "input"
  | "hud"
  | "performance"
  | "scripts"
  | "practice"
  | "other";

export type CommandComment = {
  command: string;
  section: CfgSectionId;
  comment: string;
  example?: string;
  obsolete?: boolean;
};

export type CfgCommandNode = {
  id: string;
  command: string;
  normalizedCommand: string;
  args: string[];
  argumentText: string;
  raw: string;
  section: CfgSectionId;
  line: number;
  start: number;
  end: number;
  segmentStart: number;
  segmentEnd: number;
  hasPreviousSegment: boolean;
  hasNextSegment: boolean;
};

export type CfgDocument = {
  source: string;
  bom: boolean;
  newline: "\r\n" | "\n";
  terminalNewline: boolean;
  commands: CfgCommandNode[];
};

export const sectionLabels: Record<CfgSectionId, string> = {
  crosshair: "准星",
  audio: "声音与语音",
  binds: "绑键",
  input: "鼠标与操作",
  hud: "HUD、雷达与持枪视角",
  performance: "性能与网络",
  scripts: "脚本与别名",
  practice: "练习与服务器",
  other: "其他命令",
};

export const sectionOrder = Object.keys(sectionLabels) as CfgSectionId[];

export const commandComments: CommandComment[] = [
  { command: "cl_crosshairstyle", section: "crosshair", example: "4", comment: "准星样式：2 经典动态（后坐力/散布反馈）；4 经典静态；0/1/3 已禁用；5 旧版动态（反馈不准）" },
  { command: "cl_crosshairsize", section: "crosshair", example: "2", comment: "准星线长度" },
  { command: "cl_crosshairgap", section: "crosshair", example: "-1", comment: "准星中心间距，可为负数" },
  { command: "cl_crosshairthickness", section: "crosshair", example: "0.5", comment: "准星线条粗细，常见 0–6" },
  { command: "cl_crosshairdot", section: "crosshair", example: "0", comment: "中心点：0 关 1 开" },
  { command: "cl_crosshair_drawoutline", section: "crosshair", example: "1", comment: "深色轮廓：0 关 1 开" },
  { command: "cl_crosshair_outlinethickness", section: "crosshair", example: "1", comment: "轮廓粗细 0–3" },
  { command: "cl_crosshair_t", section: "crosshair", example: "0", comment: "T 型准星（隐藏上线）：0 关 1 开" },
  { command: "cl_crosshaircolor", section: "crosshair", example: "1", comment: "颜色：0 红 1 绿 2 黄 3 蓝 4 青 5 自定义 RGB" },
  { command: "cl_crosshaircolor_r", section: "crosshair", example: "50", comment: "自定义红色 0–255，需 color 5" },
  { command: "cl_crosshaircolor_g", section: "crosshair", example: "250", comment: "自定义绿色 0–255，需 color 5" },
  { command: "cl_crosshaircolor_b", section: "crosshair", example: "50", comment: "自定义蓝色 0–255，需 color 5" },
  { command: "cl_crosshairusealpha", section: "crosshair", example: "1", comment: "使用自定义透明度：0 关 1 开" },
  { command: "cl_crosshairalpha", section: "crosshair", example: "255", comment: "准星不透明度 0–255" },
  { command: "cl_crosshair_recoil", section: "crosshair", example: "0", comment: "开火时准星跟随后坐力：0 关 1 开" },
  { command: "cl_crosshairgap_useweaponvalue", section: "crosshair", example: "0", comment: "按当前武器调整间距（动态准星）：0 关 1 开" },
  { command: "cl_crosshair_sniper_width", section: "crosshair", example: "1", comment: "狙击开镜准星线宽" },
  { command: "cl_crosshair_dynamic_splitdist", section: "crosshair", example: "7", comment: "仅 style 2：内外准星分离距离" },
  { command: "cl_crosshair_dynamic_splitalpha_innermod", section: "crosshair", example: "1", comment: "仅 style 2：内层透明倍率 0–1" },
  { command: "cl_crosshair_dynamic_splitalpha_outermod", section: "crosshair", example: "0.5", comment: "仅 style 2：外层透明倍率 0.3–1" },
  { command: "cl_crosshair_dynamic_maxdist_splitratio", section: "crosshair", example: "0.35", comment: "仅 style 2：内外层长度比 0–1" },
  { command: "cl_fixedcrosshairgap", section: "crosshair", comment: "旧默认静态准星间距；style 0/1 已禁用，通常无效", obsolete: true },
  { command: "volume", section: "audio", example: "1", comment: "游戏主音量 0–1" },
  { command: "snd_menumusic_volume", section: "audio", example: "0", comment: "主菜单音乐音量 0–1" },
  { command: "snd_roundstart_volume", section: "audio", example: "0", comment: "回合开始音乐 0–1" },
  { command: "snd_roundend_volume", section: "audio", example: "0", comment: "回合结束音乐 0–1" },
  { command: "snd_mvp_volume", section: "audio", example: "0", comment: "MVP 音乐 0–1" },
  { command: "snd_mapobjective_volume", section: "audio", example: "0.3", comment: "地图目标提示音乐 0–1" },
  { command: "snd_tensecondwarning_volume", section: "audio", example: "0.3", comment: "十秒警告音量 0–1" },
  { command: "snd_deathcamera_volume", section: "audio", example: "0", comment: "死亡镜头音乐 0–1" },
  { command: "snd_mute_losefocus", section: "audio", example: "0", comment: "切出游戏时静音：0 关 1 开" },
  { command: "voice_modenable", section: "audio", example: "1", comment: "队伍语音总开关：0 关 1 开" },
  { command: "snd_voipvolume", section: "audio", example: "1", comment: "队友语音音量 0–1（CS2 主控）" },
  { command: "voice_always_sample_mic", section: "audio", example: "0", comment: "持续采样麦克风：0 关 1 开" },
  { command: "voice_scale", section: "audio", comment: "已失效：CS2 队友语音音量改用 snd_voipvolume", obsolete: true },
  { command: "sensitivity", section: "input", example: "1", comment: "鼠标灵敏度" },
  { command: "zoom_sensitivity_ratio", section: "input", example: "1", comment: "开镜灵敏度倍率（CS2 使用此名）" },
  { command: "zoom_sensitivity_ratio_mouse", section: "input", comment: "已失效：CS2 改用 zoom_sensitivity_ratio", obsolete: true },
  { command: "cl_righthand", section: "input", example: "1", comment: "持枪左右手：1 右手 0 左手（CS2 已恢复）" },
  { command: "cl_prefer_lefthanded", section: "input", example: "0", comment: "偏好左手持枪：0 关 1 开" },
  { command: "hud_scaling", section: "hud", example: "0.85", comment: "HUD 整体缩放，CS2 常见 0.5–1" },
  { command: "cl_hud_color", section: "hud", example: "0", comment: "HUD 颜色 0–11" },
  { command: "cl_radar_scale", section: "hud", example: "0.4", comment: "雷达地图缩放 0.25–1" },
  { command: "cl_radar_always_centered", section: "hud", example: "0", comment: "玩家是否固定在雷达中心：0 关 1 开" },
  { command: "cl_radar_rotate", section: "hud", example: "1", comment: "雷达随视角旋转：0 关 1 开" },
  { command: "cl_radar_icon_scale_min", section: "hud", example: "0.6", comment: "雷达图标最小缩放" },
  { command: "cl_radar_square_with_scoreboard", section: "hud", example: "1", comment: "记分板打开时雷达改为方形：0 关 1 开" },
  { command: "viewmodel_fov", section: "hud", example: "68", comment: "持枪模型视野 54–68" },
  { command: "viewmodel_offset_x", section: "hud", example: "2.5", comment: "持枪模型左右偏移" },
  { command: "viewmodel_offset_y", section: "hud", example: "0", comment: "持枪模型前后偏移" },
  { command: "viewmodel_offset_z", section: "hud", example: "-1.5", comment: "持枪模型上下偏移" },
  { command: "viewmodel_presetpos", section: "hud", example: "1", comment: "持枪预设：1 桌面 2 大衣 3 经典；改 offset 后以自定义为准" },
  { command: "cl_showloadout", section: "hud", example: "1", comment: "始终显示装备栏：0 关 1 开" },
  { command: "cl_hud_telemetry_frametime_show", section: "hud", example: "2", comment: "帧时间：0 关 1 异常时 2 始终（替代 net_graph）" },
  { command: "cl_hud_telemetry_ping_show", section: "hud", example: "2", comment: "Ping：0 关 1 异常时 2 始终" },
  { command: "cl_hud_telemetry_net_quality_graph_show", section: "hud", example: "1", comment: "网络质量图：0 关 1 异常时 2 始终" },
  { command: "cl_hud_telemetry_server_misprediction_show", section: "hud", example: "1", comment: "服务器预测偏差：0 关 1 异常时 2 始终" },
  { command: "net_graph", section: "hud", comment: "已失效：CS2 改用 cl_hud_telemetry_*_show", obsolete: true },
  { command: "net_graphheight", section: "hud", comment: "已失效：随 net_graph 移除", obsolete: true },
  { command: "net_graphpos", section: "hud", comment: "已失效：随 net_graph 移除", obsolete: true },
  { command: "net_graphproportionalfont", section: "hud", comment: "已失效：随 net_graph 移除", obsolete: true },
  { command: "fps_max", section: "performance", example: "0", comment: "最大帧率，0 表示不限制" },
  { command: "rate", section: "performance", example: "786432", comment: "客户端网络字节速率" },
  { command: "mm_dedicated_search_maxping", section: "performance", example: "80", comment: "匹配接受的最高延迟（毫秒）" },
  { command: "cl_cmdrate", section: "performance", comment: "已失效：CS2 不再使用 CS:GO 的 cl_cmdrate", obsolete: true },
  { command: "cl_updaterate", section: "performance", comment: "已失效：CS2 不再使用 CS:GO 的 cl_updaterate", obsolete: true },
  { command: "cl_interp", section: "performance", comment: "已失效：CS2 网络插值不再用此 CS:GO 指令", obsolete: true },
  { command: "cl_interp_ratio", section: "performance", comment: "已失效：CS2 网络插值不再用此 CS:GO 指令", obsolete: true },
  { command: "mat_queue_mode", section: "performance", comment: "已失效：CS:GO 材质线程指令，CS2 无效", obsolete: true },
  { command: "cl_forcepreload", section: "performance", comment: "已失效：CS:GO 预加载指令，CS2 无效", obsolete: true },
  { command: "bind", section: "binds", comment: "绑定按键到命令，例如 bind \"f\" \"+lookatweapon\"" },
  { command: "unbind", section: "binds", comment: "解除指定按键绑定" },
  { command: "unbindall", section: "binds", comment: "清除全部按键绑定，执行后需重新绑定" },
  { command: "alias", section: "scripts", comment: "定义命令别名" },
  { command: "exec", section: "scripts", comment: "执行 cfg 目录中的其他配置文件" },
  { command: "echo", section: "scripts", comment: "向控制台输出文本" },
  { command: "host_writeconfig", section: "scripts", comment: "把当前设置写回游戏配置，可能覆盖注释与自定义 cfg" },
  { command: "sv_cheats", section: "practice", comment: "作弊开关，仅本地/练习可用：0 关 1 开" },
];

const commandCommentMap = new Map(
  commandComments.map((item) => [item.command, item]),
);

export const commentForCommand = (command: string) =>
  commandCommentMap.get(command.toLowerCase());

export function defaultCfgTemplate() {
  const lines = [
    "// Steam Account Manager 管理的 CS2 autoexec.cfg",
    "// 切号时复制到游戏 game\\csgo\\cfg，并以 +exec 本文件名启动。",
    "// 不会改写游戏实时生成的 .vcfg。可用「刷新注释」按当前 CS2 指令库更新行尾说明。",
    "",
  ];
  let lastSection: CfgSectionId | undefined;
  for (const item of commandComments) {
    if (item.example === undefined) continue;
    if (item.section !== lastSection) {
      if (lastSection) lines.push("");
      lines.push(`// --- ${sectionLabels[item.section]} ---`);
      lastSection = item.section;
    }
    lines.push(`${item.command} ${item.example} // ${item.comment}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function sectionForCommand(command: string): CfgSectionId {
  const value = command.toLowerCase();
  const defined = commandCommentMap.get(value);
  if (defined) return defined.section;
  if (value.startsWith("cl_crosshair") || value === "cl_fixedcrosshairgap") return "crosshair";
  if (["bind", "unbind", "unbindall", "bindtoggle", "key_listboundkeys"].includes(value)) return "binds";
  if (value === "volume" || value.startsWith("snd_") || value.startsWith("voice_")) return "audio";
  if (value === "sensitivity" || value === "zoom_sensitivity_ratio" || value.startsWith("m_") || value.startsWith("input_")) return "input";
  if (value.startsWith("cl_hud") || value.startsWith("hud_") || value.startsWith("cl_radar") || value.startsWith("viewmodel_") || value.startsWith("safezone")) return "hud";
  if (value === "fps_max" || value === "rate" || value.startsWith("r_") || value.startsWith("engine_") || value.startsWith("cl_interp")) return "performance";
  if (["alias", "exec", "echo", "toggle", "incrementvar", "wait"].includes(value)) return "scripts";
  if (["noclip", "god", "buddha", "map"].includes(value) || value.startsWith("sv_") || value.startsWith("mp_") || value.startsWith("bot_") || value.startsWith("ammo_") || value.startsWith("grenade_")) return "practice";
  return "other";
}

function trailingCommentIndex(line: string) {
  let quoted = false;
  let escaping = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaping) {
      escaping = false;
    } else if (
      character === "\\" &&
      quoted &&
      (line[index + 1] === "\\" || line[index + 1] === '"')
    ) {
      escaping = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === "/" && line[index + 1] === "/") {
      return index;
    }
  }
  return -1;
}

export function annotateCfgComments(source: string) {
  const bom = source.startsWith("\uFEFF");
  const body = bom ? source.slice(1) : source;
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const terminalNewline = body.endsWith("\n");
  const lines = body.split(/\r?\n/);
  if (terminalNewline && lines.at(-1) === "") lines.pop();

  const document = parseCfg(source);
  const commandsByLine = new Map<number, CfgCommandNode[]>();
  for (const node of document.commands) {
    const list = commandsByLine.get(node.line) ?? [];
    list.push(node);
    commandsByLine.set(node.line, list);
  }

  const annotated = lines.map((line, index) => {
    const nodes = commandsByLine.get(index + 1);
    if (!nodes?.length) return line;
    let comment: string | undefined;
    for (let cursor = nodes.length - 1; cursor >= 0; cursor -= 1) {
      const found = commentForCommand(nodes[cursor].normalizedCommand);
      if (found) {
        comment = found.comment;
        break;
      }
    }
    if (!comment) return line;
    const cut = trailingCommentIndex(line);
    const code = (cut === -1 ? line : line.slice(0, cut)).trimEnd();
    if (!code.trim()) return line;
    return `${code} // ${comment}`;
  });

  return `${bom ? "\uFEFF" : ""}${annotated.join(newline)}${terminalNewline || body.length === 0 ? newline : ""}`;
}

function tokenize(input: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  let started = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (character === "\\" && quoted && (next === "\\" || next === '"')) {
      value += next;
      index += 1;
      started = true;
    } else if (character === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(character) && !quoted) {
      if (started) {
        values.push(value);
        value = "";
        started = false;
      }
    } else {
      value += character;
      started = true;
    }
  }
  if (started) values.push(value);
  return values;
}

function firstTokenEnd(input: string): number {
  let index = 0;
  while (index < input.length && !/\s/.test(input[index])) index += 1;
  return index;
}

export function parseCfg(source: string): CfgDocument {
  const commands: CfgCommandNode[] = [];
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  let lineStart = 0;
  let lineNumber = 1;
  while (lineStart <= source.length) {
    const newlineIndex = source.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? source.length : newlineIndex - (source[newlineIndex - 1] === "\r" ? 1 : 0);
    const rawLine = source.slice(lineStart, lineEnd);
    const separators: number[] = [];
    let quoted = false;
    let escaping = false;
    let commentStart = rawLine.length;
    for (let index = 0; index < rawLine.length; index += 1) {
      const character = rawLine[index];
      if (escaping) {
        escaping = false;
      } else if (
        character === "\\" &&
        quoted &&
        (rawLine[index + 1] === "\\" || rawLine[index + 1] === '"')
      ) {
        escaping = true;
      } else if (character === "\"") {
        quoted = !quoted;
      } else if (!quoted && character === "/" && rawLine[index + 1] === "/") {
        commentStart = index;
        break;
      } else if (!quoted && character === ";") {
        separators.push(index);
      }
    }
    const boundaries = [-1, ...separators.filter((value) => value < commentStart), commentStart];
    for (let segmentIndex = 0; segmentIndex < boundaries.length - 1; segmentIndex += 1) {
      const localSegmentStart = boundaries[segmentIndex] + 1;
      const localSegmentEnd = boundaries[segmentIndex + 1];
      const rawSegment = rawLine.slice(localSegmentStart, localSegmentEnd);
      const leading = rawSegment.length - rawSegment.trimStart().length;
      const trailing = rawSegment.length - rawSegment.trimEnd().length;
      const trimmedWithBom = rawSegment.trim();
      const hasLeadingBom =
        lineStart === 0 &&
        localSegmentStart + leading === 0 &&
        trimmedWithBom.startsWith("\uFEFF");
      const trimmed = hasLeadingBom
        ? trimmedWithBom.slice(1).trimStart()
        : trimmedWithBom;
      if (!trimmed) continue;
      const tokens = tokenize(trimmed);
      if (!tokens.length) continue;
      const command = tokens[0];
      const tokenEnd = firstTokenEnd(trimmed);
      const start =
        lineStart + localSegmentStart + leading + (hasLeadingBom ? 1 : 0);
      const end = lineStart + localSegmentEnd - trailing;
      commands.push({
        id: `${start}:${end}:${command.toLowerCase()}`,
        command,
        normalizedCommand: command.toLowerCase(),
        args: tokens.slice(1),
        argumentText: trimmed.slice(tokenEnd).trim(),
        raw: trimmed,
        section: sectionForCommand(command),
        line: lineNumber,
        start,
        end,
        segmentStart: lineStart + localSegmentStart,
        segmentEnd: lineStart + localSegmentEnd,
        hasPreviousSegment: segmentIndex > 0,
        hasNextSegment: segmentIndex < boundaries.length - 2,
      });
    }
    if (newlineIndex === -1) break;
    lineStart = newlineIndex + 1;
    lineNumber += 1;
  }
  return {
    source,
    bom: source.startsWith("\uFEFF"),
    newline,
    terminalNewline: source.endsWith("\n"),
    commands,
  };
}

export const effectiveCommand = (document: CfgDocument, command: string) =>
  document.commands
    .filter((node) => node.normalizedCommand === command.toLowerCase())
    .at(-1);

export const duplicateCount = (document: CfgDocument, command: string) =>
  Math.max(
    0,
    document.commands.filter(
      (node) => node.normalizedCommand === command.toLowerCase(),
    ).length - 1,
  );

function quoteArgument(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function replaceRange(source: string, start: number, end: number, value: string) {
  return `${source.slice(0, start)}${value}${source.slice(end)}`;
}

export function updateCommandNode(
  source: string,
  id: string,
  command: string,
  argumentText: string,
) {
  const node = parseCfg(source).commands.find((candidate) => candidate.id === id);
  if (!node) return source;
  const next = `${command.trim()}${argumentText.trim() ? ` ${argumentText.trim()}` : ""}`;
  return replaceRange(source, node.start, node.end, next);
}

export function appendCommand(source: string, command: string, args: string[]) {
  const document = parseCfg(source);
  const separator = source && !document.terminalNewline ? document.newline : "";
  const prefix = source ? `${separator}` : document.bom ? "\uFEFF" : "";
  return `${source}${prefix}${command}${args.length ? ` ${args.map(quoteArgument).join(" ")}` : ""}${document.newline}`;
}

export function setScalarCommand(source: string, command: string, value: string) {
  const node = effectiveCommand(parseCfg(source), command);
  if (node) {
    return replaceRange(source, node.start, node.end, `${node.command} ${quoteArgument(value)}`);
  }
  return appendCommand(source, command, [value]);
}

export function removeCommandNode(source: string, id: string) {
  const node = parseCfg(source).commands.find((candidate) => candidate.id === id);
  if (!node) return source;
  if (node.hasNextSegment) {
    return replaceRange(source, node.segmentStart, node.segmentEnd + 1, "");
  }
  if (node.hasPreviousSegment) {
    return replaceRange(source, node.segmentStart - 1, node.segmentEnd, "");
  }
  return replaceRange(source, node.segmentStart, node.segmentEnd, "");
}

export function removeScalarCommand(source: string, command: string) {
  let next = source;
  while (true) {
    const node = parseCfg(next).commands.find(
      (candidate) => candidate.normalizedCommand === command.toLowerCase(),
    );
    if (!node) return next;
    next = removeCommandNode(next, node.id);
  }
}

export function commandValue(node?: CfgCommandNode) {
  return node?.args[0];
}

export function commandLinesForSection(document: CfgDocument, section: CfgSectionId) {
  return document.commands.filter((node) => node.section === section);
}
