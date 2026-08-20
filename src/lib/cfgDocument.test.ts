/** Regression tests for lossless CFG parsing, categorization, and targeted edits. */
import { describe, expect, it } from "vitest";
import {
  annotateCfgComments,
  appendCommand,
  defaultCfgTemplate,
  duplicateCount,
  effectiveCommand,
  parseCfg,
  removeCommandNode,
  removeScalarCommand,
  setScalarCommand,
  updateCommandNode,
} from "./cfgDocument";

describe("CFG document", () => {
  it("preserves BOM, CRLF, comments, quoted semicolons, and unknown commands", () => {
    const source =
      "\uFEFF// 配置\r\nbind \"mouse4\" \"+jump; -attack\"; volume 0.5 // 声音\r\ncustom_cmd \"https://example.com/a;b\"\r\n";
    const document = parseCfg(source);
    expect(document.bom).toBe(true);
    expect(document.newline).toBe("\r\n");
    expect(document.commands.map((node) => node.command)).toEqual([
      "bind",
      "volume",
      "custom_cmd",
    ]);
    expect(document.commands[0].args).toEqual(["mouse4", "+jump; -attack"]);
    expect(document.source).toBe(source);
  });

  it("parses a command immediately after a BOM", () => {
    const source = "\uFEFFvolume 0.5\r\n";
    const document = parseCfg(source);
    expect(document.commands[0].command).toBe("volume");
    expect(setScalarCommand(source, "volume", "0.8")).toBe(
      "\uFEFFvolume \"0.8\"\r\n",
    );
  });

  it("keeps escaped quotes and inline comments untouched on a no-op roundtrip", () => {
    const source = 'alias "say_hi" "say \\"hello; team\\""; echo done // note\n';
    const document = parseCfg(source);
    expect(document.commands.map((node) => node.command)).toEqual([
      "alias",
      "echo",
    ]);
    expect(document.commands[0].args[1]).toBe('say "hello; team"');
    expect(document.source).toBe(source);
  });

  it("does not consume ordinary backslashes inside quoted paths", () => {
    const document = parseCfg('exec "C:\\cfg\\practice.cfg"\n');
    expect(document.commands[0].args[0]).toBe("C:\\cfg\\practice.cfg");
  });

  it("classifies commands and applies last-value-wins semantics", () => {
    const document = parseCfg(
      "volume 0.2\ncl_crosshairsize 2\nvolume 0.8\nbind \"q\" \"lastinv\"\n",
    );
    expect(effectiveCommand(document, "volume")?.args[0]).toBe("0.8");
    expect(duplicateCount(document, "volume")).toBe(1);
    expect(document.commands.map((node) => node.section)).toEqual([
      "audio",
      "crosshair",
      "audio",
      "binds",
    ]);
  });

  it("updates only the effective scalar command and preserves surrounding text", () => {
    const source = "volume 0.2\r\nvolume   0.8 // active\r\n";
    expect(setScalarCommand(source, "volume", "0.65")).toBe(
      "volume 0.2\r\nvolume \"0.65\" // active\r\n",
    );
  });

  it("adds commands using the original newline style", () => {
    expect(appendCommand("fps_max 300\r\n", "volume", ["0.5"])).toBe(
      "fps_max 300\r\nvolume \"0.5\"\r\n",
    );
  });

  it("edits and removes an exact command in a semicolon chain", () => {
    const source = "bind \"q\" \"lastinv\"; volume 0.5; fps_max 300 // keep\n";
    const bind = parseCfg(source).commands[0];
    const changed = updateCommandNode(source, bind.id, "bind", "\"e\" \"+use\"");
    expect(changed).toContain('bind "e" "+use"; volume 0.5');
    const volume = parseCfg(changed).commands.find((node) => node.command === "volume")!;
    expect(removeCommandNode(changed, volume.id)).toBe(
      'bind "e" "+use"; fps_max 300 // keep\n',
    );
  });

  it("removes every scalar override without disturbing other lines", () => {
    expect(removeScalarCommand("volume 0.2\nfps_max 300\nvolume 0.8\n", "volume")).toBe(
      "\nfps_max 300\n\n",
    );
  });

  it("annotates current CS2 commands and marks obsolete leftovers", () => {
    const source =
      "fps_max 300 // 旧说明\r\nnet_graph 1\r\nbind \"q\" \"lastinv\"\r\ncustom_cmd 1 // 保留\r\n";
    expect(annotateCfgComments(source)).toBe(
      "fps_max 300 // 最大帧率，0 表示不限制\r\nnet_graph 1 // 已失效：CS2 改用 cl_hud_telemetry_*_show\r\nbind \"q\" \"lastinv\" // 绑定按键到命令，例如 bind \"f\" \"+lookatweapon\"\r\ncustom_cmd 1 // 保留\r\n",
    );
  });

  it("keeps the default template comments in sync with the command library", async () => {
    const template = defaultCfgTemplate();
    const bundled = (await import("./cs2-autoexec.template.cfg?raw")).default.replace(
      /\r\n/g,
      "\n",
    );
    expect(bundled).toBe(template);
    expect(annotateCfgComments(template)).toBe(template);
    expect(template).toContain("cl_hud_telemetry_frametime_show 2");
    expect(template).toContain("snd_voipvolume 1");
    expect(template).toContain("cl_righthand 1");
    expect(template).toContain("zoom_sensitivity_ratio 1");
    expect(template).not.toMatch(/(^|\n)net_graph /);
    expect(template).not.toMatch(/(^|\n)voice_scale /);
  });
});
