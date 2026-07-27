/** Lossless CS2 CFG parsing, classification, and targeted text mutation utilities. */
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

export type CommandControl = "boolean" | "number" | "select" | "text";

export type CommandDefinition = {
  command: string;
  label: string;
  section: CfgSectionId;
  control: CommandControl;
  description: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
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

const booleanOptions = [
  { value: "0", label: "关闭" },
  { value: "1", label: "开启" },
];

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

export const commandDefinitions: CommandDefinition[] = [
  { command: "cl_crosshairstyle", label: "准星样式", section: "crosshair", control: "select", description: "选择默认、经典动态或经典静态样式。", options: [
    { value: "0", label: "默认" }, { value: "1", label: "默认静态" }, { value: "2", label: "经典" },
    { value: "3", label: "经典动态" }, { value: "4", label: "经典静态" }, { value: "5", label: "经典动态 2" },
  ] },
  { command: "cl_crosshairsize", label: "长度", section: "crosshair", control: "number", description: "每条准星线的长度。", min: 0, max: 20, step: 0.1 },
  { command: "cl_crosshairgap", label: "间距", section: "crosshair", control: "number", description: "准星中心与线条之间的距离。", min: -10, max: 10, step: 0.1 },
  { command: "cl_crosshairthickness", label: "粗细", section: "crosshair", control: "number", description: "准星线条粗细。", min: 0, max: 6, step: 0.1 },
  { command: "cl_crosshairdot", label: "中心点", section: "crosshair", control: "boolean", description: "显示准星中心点。", options: booleanOptions },
  { command: "cl_crosshair_drawoutline", label: "轮廓", section: "crosshair", control: "boolean", description: "为准星绘制深色轮廓。", options: booleanOptions },
  { command: "cl_crosshair_outlinethickness", label: "轮廓粗细", section: "crosshair", control: "number", description: "准星轮廓的粗细。", min: 0, max: 3, step: 0.5 },
  { command: "cl_crosshair_t", label: "T 型准星", section: "crosshair", control: "boolean", description: "隐藏顶部准星线。", options: booleanOptions },
  { command: "cl_crosshaircolor", label: "颜色模式", section: "crosshair", control: "select", description: "0–4 为预设颜色，5 使用自定义 RGB。", options: [
    { value: "0", label: "红色" }, { value: "1", label: "绿色" }, { value: "2", label: "黄色" },
    { value: "3", label: "蓝色" }, { value: "4", label: "青色" }, { value: "5", label: "自定义 RGB" },
  ] },
  { command: "cl_crosshaircolor_r", label: "红色", section: "crosshair", control: "number", description: "自定义颜色的红色通道。", min: 0, max: 255, step: 1 },
  { command: "cl_crosshaircolor_g", label: "绿色", section: "crosshair", control: "number", description: "自定义颜色的绿色通道。", min: 0, max: 255, step: 1 },
  { command: "cl_crosshaircolor_b", label: "蓝色", section: "crosshair", control: "number", description: "自定义颜色的蓝色通道。", min: 0, max: 255, step: 1 },
  { command: "cl_crosshairusealpha", label: "使用透明度", section: "crosshair", control: "boolean", description: "使用自定义透明度。", options: booleanOptions },
  { command: "cl_crosshairalpha", label: "透明度", section: "crosshair", control: "number", description: "准星不透明度。", min: 0, max: 255, step: 1 },
  { command: "cl_crosshair_recoil", label: "跟随后坐力", section: "crosshair", control: "boolean", description: "开火时让准星跟随后坐力。", options: booleanOptions },
  { command: "cl_crosshairgap_useweaponvalue", label: "使用武器间距", section: "crosshair", control: "boolean", description: "按当前武器调整准星间距。", options: booleanOptions },
  { command: "cl_fixedcrosshairgap", label: "固定间距", section: "crosshair", control: "number", description: "默认静态准星使用的固定间距。", min: -10, max: 10, step: 0.1 },
  { command: "cl_crosshair_dynamic_splitdist", label: "动态分离距离", section: "crosshair", control: "number", description: "动态准星分离距离。", min: 0, max: 20, step: 1 },
  { command: "cl_crosshair_dynamic_splitalpha_innermod", label: "内层透明倍率", section: "crosshair", control: "number", description: "动态准星内层透明倍率。", min: 0, max: 1, step: 0.05 },
  { command: "cl_crosshair_dynamic_splitalpha_outermod", label: "外层透明倍率", section: "crosshair", control: "number", description: "动态准星外层透明倍率。", min: 0, max: 1, step: 0.05 },
  { command: "cl_crosshair_dynamic_maxdist_splitratio", label: "动态分离比例", section: "crosshair", control: "number", description: "动态准星内外层分离比例。", min: 0, max: 1, step: 0.05 },
  { command: "volume", label: "主音量", section: "audio", control: "number", description: "游戏总音量。", min: 0, max: 1, step: 0.01 },
  { command: "snd_menumusic_volume", label: "菜单音乐", section: "audio", control: "number", description: "主菜单音乐音量。", min: 0, max: 1, step: 0.01 },
  { command: "snd_roundstart_volume", label: "回合开始音乐", section: "audio", control: "number", description: "回合开始提示音乐音量。", min: 0, max: 1, step: 0.01 },
  { command: "snd_roundend_volume", label: "回合结束音乐", section: "audio", control: "number", description: "回合结束提示音乐音量。", min: 0, max: 1, step: 0.01 },
  { command: "snd_mvp_volume", label: "MVP 音乐", section: "audio", control: "number", description: "MVP 音乐音量。", min: 0, max: 1, step: 0.01 },
  { command: "voice_modenable", label: "队伍语音", section: "audio", control: "boolean", description: "启用或关闭队伍语音。", options: booleanOptions },
  { command: "voice_scale", label: "队友音量", section: "audio", control: "number", description: "队友语音音量倍率。", min: 0, max: 1, step: 0.01 },
  { command: "sensitivity", label: "鼠标灵敏度", section: "input", control: "number", description: "鼠标灵敏度倍率。", min: 0.01, max: 20, step: 0.01 },
  { command: "zoom_sensitivity_ratio", label: "开镜灵敏度", section: "input", control: "number", description: "开镜时的灵敏度倍率。", min: 0.1, max: 3, step: 0.01 },
  { command: "cl_radar_scale", label: "雷达缩放", section: "hud", control: "number", description: "雷达地图缩放比例。", min: 0.25, max: 1, step: 0.01 },
  { command: "cl_radar_always_centered", label: "雷达始终居中", section: "hud", control: "boolean", description: "让玩家始终位于雷达中心。", options: booleanOptions },
  { command: "hud_scaling", label: "HUD 缩放", section: "hud", control: "number", description: "HUD 整体缩放比例。", min: 0.5, max: 0.95, step: 0.01 },
  { command: "viewmodel_fov", label: "持枪视野", section: "hud", control: "number", description: "持枪模型视野。", min: 54, max: 68, step: 1 },
  { command: "viewmodel_offset_x", label: "持枪横向位置", section: "hud", control: "number", description: "持枪模型左右偏移。", min: -2.5, max: 2.5, step: 0.1 },
  { command: "viewmodel_offset_y", label: "持枪纵向位置", section: "hud", control: "number", description: "持枪模型前后偏移。", min: -2, max: 2, step: 0.1 },
  { command: "viewmodel_offset_z", label: "持枪高度", section: "hud", control: "number", description: "持枪模型上下偏移。", min: -2, max: 2, step: 0.1 },
  { command: "fps_max", label: "最大帧率", section: "performance", control: "number", description: "客户端最大帧率，0 表示不限制。", min: 0, max: 1000, step: 1 },
  { command: "rate", label: "网络速率", section: "performance", control: "number", description: "客户端网络字节速率。", min: 98304, max: 1000000, step: 1 },
];

const definitionMap = new Map(
  commandDefinitions.map((definition) => [definition.command, definition]),
);

export const definitionFor = (command: string) =>
  definitionMap.get(command.toLowerCase());

export function sectionForCommand(command: string): CfgSectionId {
  const value = command.toLowerCase();
  const defined = definitionFor(value);
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
