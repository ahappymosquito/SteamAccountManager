/** UI regressions for CFG file editing, comment refresh, autosave, and export. */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCfgTemplate } from "../lib/cfgDocument";

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
  captureRuntimeCfgs: vi.fn(),
  runtimeCfgAccounts: vi.fn(),
  openRuntimeCfgSnapshot: vi.fn(),
  applyRuntimeCfgSnapshot: vi.fn(),
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
    apiMock.activeCfgProfile.mockResolvedValue(profile);
    apiMock.cfgProfiles.mockResolvedValue([profile]);
    apiMock.setActiveCfgProfile.mockResolvedValue(secondaryProfile);
    apiMock.createCfgProfile.mockImplementation(
      async (name: string, fileName: string, content: string) => ({
        id: "cfg-new",
        name,
        fileName,
        content,
        createdAt: "",
        updatedAt: "",
      }),
    );
    apiMock.deleteCfgProfile.mockResolvedValue(undefined);
    apiMock.saveCfgProfile.mockResolvedValue(undefined);
    apiMock.exportCfgProfile.mockResolvedValue("C:\\exports\\autoexec.cfg");
    apiMock.settings.mockResolvedValue({});
    apiMock.setSetting.mockResolvedValue(undefined);
    apiMock.captureRuntimeCfgs.mockResolvedValue({
      captured: 0,
      unchanged: 0,
      skippedRunning: false,
      accounts: [],
    });
    apiMock.runtimeCfgAccounts.mockResolvedValue([]);
    clipboardMock.writeText.mockResolvedValue(undefined);
  });

  it("opens the source editor and autosaves edits", async () => {
    render(<Cs2Page notify={vi.fn()} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    expect(screen.queryByRole("tab", { name: "可视化配置" })).not.toBeInTheDocument();
    const editor = screen.getByLabelText("CFG 编辑器");
    expect(editor).toHaveValue("fps_max 300\ncl_crosshairsize 2\n");
    fireEvent.change(editor, {
      target: { value: "fps_max 500\ncl_crosshairsize 2\n" },
    });
    await waitFor(
      () =>
        expect(apiMock.saveCfgProfile).toHaveBeenCalledWith(
          "cfg-1",
          "主配置",
          "fps_max 500\ncl_crosshairsize 2\n",
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

  it("copies CFG crosshair commands from the file", async () => {
    render(<Cs2Page notify={vi.fn()} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    fireEvent.click(screen.getByRole("button", { name: "复制准星命令" }));
    await waitFor(() =>
      expect(clipboardMock.writeText).toHaveBeenCalledWith("cl_crosshairsize 2"),
    );
  });

  it("refreshes known command comments without changing values", async () => {
    const notify = vi.fn();
    render(<Cs2Page notify={notify} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    fireEvent.click(screen.getByRole("button", { name: "刷新注释" }));
    expect(screen.getByLabelText("CFG 编辑器")).toHaveValue(
      "fps_max 300 // 最大帧率，0 表示不限制\ncl_crosshairsize 2 // 准星线长度\n",
    );
    expect(notify).toHaveBeenCalledWith(
      "success",
      "已按当前 CS2 指令库刷新行尾注释，命令值未改",
    );
  });

  it("creates a new profile from the current CS2 template", async () => {
    render(<Cs2Page notify={vi.fn()} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    fireEvent.click(screen.getByRole("button", { name: "新建 CFG" }));
    await waitFor(() =>
      expect(apiMock.createCfgProfile).toHaveBeenCalledWith(
        "新配置 2",
        expect.stringMatching(/^profile-\d{6}\.cfg$/),
        defaultCfgTemplate(),
      ),
    );
    expect(screen.getByLabelText("CFG 编辑器")).toHaveValue(defaultCfgTemplate());
  });

  it("fills an empty default profile with the annotated template", async () => {
    apiMock.activeCfgProfile.mockResolvedValue({ ...profile, content: "" });
    render(<Cs2Page notify={vi.fn()} />);
    const editor = await screen.findByLabelText("CFG 编辑器");
    expect(editor).toHaveValue(defaultCfgTemplate());
    await waitFor(
      () =>
        expect(apiMock.saveCfgProfile).toHaveBeenCalledWith(
          "cfg-1",
          "主配置",
          defaultCfgTemplate(),
        ),
      { timeout: 1500 },
    );
  });

  it("uses one global description and omits visual tools and file identity", async () => {
    const { container } = render(<Cs2Page notify={vi.fn()} />);
    await screen.findByRole("option", { name: "主配置 · autoexec.cfg" });
    expect(
      screen.getByText(
        "切号、扫描和打开本页时会自动采集各账号已运行过的 CS2 配置并留下记录。编辑仍只改本应用方案，不会写入游戏实时文件，也不会启动游戏。",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector(".editor-file-name")).not.toBeInTheDocument();
    expect(screen.queryByText("历史版本与运行文件")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入 CFG 参数库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出 CFG 参数库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制官方分享码" })).not.toBeInTheDocument();
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

  it("lists captured runtime configs and opens the linked profile", async () => {
    const runtimeProfile = {
      ...profile,
      id: "cfg-runtime",
      name: "运行 · 主力",
      fileName: "runtime-39734272.cfg",
      source: "runtime",
    };
    apiMock.captureRuntimeCfgs.mockResolvedValue({
      captured: 1,
      unchanged: 0,
      skippedRunning: false,
      accounts: [
        {
          steamAccountId: "acc-1",
          steamId64: "76561198000000000",
          personaName: "主力",
          snapshotId: "snap-1",
          capturedAt: "2026-09-04T10:00:00Z",
          lastSeenAt: "2026-09-04T10:00:00Z",
          trigger: "scan",
          sourcePath: "C:\\Steam\\userdata\\39734272\\730\\local\\cfg",
          contentHash: "abc",
          fileCount: 2,
          files: [],
          historyCount: 1,
          profileId: "cfg-runtime",
          profileName: "运行 · 主力",
          profileFileName: "runtime-39734272.cfg",
          profileDirty: false,
        },
      ],
    });
    apiMock.openRuntimeCfgSnapshot.mockResolvedValue(runtimeProfile);
    apiMock.cfgProfiles.mockResolvedValue([profile, runtimeProfile]);
    apiMock.setActiveCfgProfile.mockResolvedValue(runtimeProfile);
    const notify = vi.fn();
    render(<Cs2Page notify={notify} />);
    await screen.findByRole("button", { name: "主力" });
    fireEvent.click(screen.getByRole("button", { name: "主力" }));
    await waitFor(() =>
      expect(apiMock.openRuntimeCfgSnapshot).toHaveBeenCalledWith("snap-1"),
    );
    expect(notify).toHaveBeenCalledWith("success", "已打开 主力 的运行配置");
  });
});
