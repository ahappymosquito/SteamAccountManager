/** UI regressions for the compact CFG toolbar, visual/source sync, autosave, and export. */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const profile = {
  id: "cfg-1",
  name: "主配置",
  fileName: "autoexec.cfg",
  content: "fps_max 300\ncl_crosshairsize 2\n",
  createdAt: "",
  updatedAt: "",
};
const secondaryProfile = {
  ...profile,
  id: "cfg-2",
  name: "竞技配置",
  fileName: "competitive.cfg",
};
const apiMock = vi.hoisted(() => ({
  activeCfgProfile: vi.fn(),
  cfgProfiles: vi.fn(),
  setActiveCfgProfile: vi.fn(),
  createCfgProfile: vi.fn(),
  importCfgProfile: vi.fn(),
  deleteCfgProfile: vi.fn(),
  saveCfgProfile: vi.fn(),
  exportCfgProfile: vi.fn(),
  settings: vi.fn(),
  setSetting: vi.fn(),
  readCfgDefinitionFile: vi.fn(),
  writeCfgDefinitionFile: vi.fn(),
}));
const dialogMock = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}));
const clipboardMock = vi.hoisted(() => ({ writeText: vi.fn() }));
vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("@tauri-apps/plugin-dialog", () => dialogMock);
vi.mock("@tauri-apps/plugin-clipboard-manager", () => clipboardMock);

import { Cs2Page } from "./Cs2Page";

describe("Cs2Page", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    apiMock.activeCfgProfile.mockResolvedValue(profile);
    apiMock.cfgProfiles.mockResolvedValue([profile]);
    apiMock.setActiveCfgProfile.mockResolvedValue(secondaryProfile);
    apiMock.deleteCfgProfile.mockResolvedValue(undefined);
    apiMock.saveCfgProfile.mockResolvedValue(undefined);
    apiMock.exportCfgProfile.mockResolvedValue("C:\\exports\\autoexec.cfg");
    apiMock.settings.mockResolvedValue({});
    apiMock.setSetting.mockResolvedValue(undefined);
    apiMock.writeCfgDefinitionFile.mockResolvedValue(
      "C:\\exports\\cs2-cfg-parameters.jsonc",
    );
    clipboardMock.writeText.mockResolvedValue(undefined);
  });

  it("opens in visual mode and synchronizes a control back to source/autosave", async () => {
    render(<Cs2Page notify={vi.fn()} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    expect(
      screen.getByRole("tab", { name: "可视化配置" }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: /性能与网络/ }));
    fireEvent.change(screen.getByLabelText("最大帧率"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "CFG 源码" }));
    expect(screen.getByLabelText("CFG 编辑器")).toHaveValue(
      'fps_max "500"\ncl_crosshairsize 2\n',
    );
    await waitFor(
      () =>
        expect(apiMock.saveCfgProfile).toHaveBeenCalledWith(
          "cfg-1",
          "主配置",
          'fps_max "500"\ncl_crosshairsize 2\n',
        ),
      { timeout: 1500 },
    );
  });

  it("flushes the draft before exporting and reports the normalized path", async () => {
    const notify = vi.fn();
    dialogMock.save.mockResolvedValue("C:\\exports\\autoexec");
    render(<Cs2Page notify={notify} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    fireEvent.click(screen.getByRole("button", { name: "导出 CFG" }));
    await waitFor(() =>
      expect(apiMock.exportCfgProfile).toHaveBeenCalledWith(
        "cfg-1",
        "C:\\exports\\autoexec",
      ),
    );
    expect(notify).toHaveBeenCalledWith(
      "success",
      "已导出到 C:\\exports\\autoexec.cfg",
    );
  });

  it("copies CFG crosshair commands and disables incomplete official codes", async () => {
    render(<Cs2Page notify={vi.fn()} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    expect(
      screen.getByRole("button", { name: "复制官方分享码" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "复制 CFG 准星命令" }),
    );
    await waitFor(() =>
      expect(clipboardMock.writeText).toHaveBeenCalledWith(
        "cl_crosshairsize 2",
      ),
    );
  });

  it("exports a JSONC parameter library with the GPT prompt at the top", async () => {
    dialogMock.save.mockResolvedValue("C:\\exports\\cs2-cfg-parameters.jsonc");
    render(<Cs2Page notify={vi.fn()} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    const exportLibrary = screen.getByRole("button", {
      name: "导出 CFG 参数库",
    });
    expect(exportLibrary.closest(".editor-tabbar")).toBeInTheDocument();
    fireEvent.click(exportLibrary);
    await waitFor(() =>
      expect(apiMock.writeCfgDefinitionFile).toHaveBeenCalled(),
    );
    const [, content] = apiMock.writeCfgDefinitionFile.mock.calls[0];
    expect(content.startsWith("/*\nGPT 维护提示词：")).toBe(true);
    expect(content).toContain('"schemaVersion": 1');
  });

  it("imports, persists, and displays a custom parameter definition", async () => {
    dialogMock.open.mockResolvedValue("C:\\imports\\cfg-parameters.jsonc");
    apiMock.readCfgDefinitionFile.mockResolvedValue(`{
      "schemaVersion": 1,
      "definitions": [{
        "command": "custom_training_note",
        "label": "训练备注",
        "section": "other",
        "control": "text",
        "description": "供训练脚本读取的文本备注。"
      }]
    }`);
    render(<Cs2Page notify={vi.fn()} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    const importLibrary = screen.getByRole("button", {
      name: "导入 CFG 参数库",
    });
    expect(importLibrary.closest(".editor-tabbar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /添加命令到准星/ }),
    ).toHaveAttribute("title", "添加到当前分区：准星");
    fireEvent.click(importLibrary);
    await waitFor(() =>
      expect(apiMock.setSetting).toHaveBeenCalledWith(
        "cfg_command_definitions",
        expect.arrayContaining([
          expect.objectContaining({ command: "custom_training_note" }),
        ]),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /其他命令/ }));
    expect(screen.getByLabelText("训练备注")).toBeInTheDocument();
  });

  it("uses one global description and omits removed auxiliary tools and file identity", async () => {
    const { container } = render(<Cs2Page notify={vi.fn()} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    expect(
      screen.getByText(
        "可视化或源码编辑 CFG，修改会自动保存；不会写入游戏实时文件，也不会启动游戏。",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector(".editor-file-name")).not.toBeInTheDocument();
    expect(screen.queryByText("历史版本与运行文件")).not.toBeInTheDocument();
    expect(screen.queryByText("历史版本")).not.toBeInTheDocument();
    expect(screen.queryByText("运行文件")).not.toBeInTheDocument();
    expect(
      screen.queryByText("修改会精准写回对应命令，并沿用 500ms 自动保存。"),
    ).not.toBeInTheDocument();
  });

  it("switches profiles and supports inline rename with autosave", async () => {
    apiMock.cfgProfiles.mockResolvedValue([profile, secondaryProfile]);
    render(<Cs2Page notify={vi.fn()} />);
    const picker = await screen.findByRole("combobox", { name: "当前 CFG" });

    fireEvent.change(picker, { target: { value: "cfg-2" } });
    await waitFor(() =>
      expect(apiMock.setActiveCfgProfile).toHaveBeenCalledWith("cfg-2"),
    );
    expect(
      screen.getByRole("combobox", { name: "当前 CFG" }),
    ).toHaveValue("cfg-2");

    fireEvent.click(screen.getByRole("button", { name: "重命名 CFG" }));
    const nameInput = screen.getByRole("textbox", { name: "方案名称" });
    fireEvent.change(nameInput, { target: { value: "赛事方案" } });
    fireEvent.blur(nameInput);
    await waitFor(() =>
      expect(apiMock.saveCfgProfile).toHaveBeenCalledWith(
        "cfg-2",
        "赛事方案",
        secondaryProfile.content,
      ),
      { timeout: 1500 },
    );
    expect(
      screen.getByRole("option", { name: "赛事方案 · competitive.cfg" }),
    ).toBeInTheDocument();
  });

  it("keeps delete disabled when only one CFG profile exists", async () => {
    render(<Cs2Page notify={vi.fn()} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    expect(screen.getByRole("button", { name: "删除 CFG" })).toBeDisabled();
  });
});
