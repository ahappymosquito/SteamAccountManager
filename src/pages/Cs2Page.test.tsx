/** UI regressions for visual/source sync, export, autosave, and runtime previews. */
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
const apiMock = vi.hoisted(() => ({
  activeCfgProfile: vi.fn(),
  cfgProfiles: vi.fn(),
  cfgVersions: vi.fn(),
  cs2RuntimeFiles: vi.fn(),
  previewCs2RuntimeFile: vi.fn(),
  saveCfgProfile: vi.fn(),
  exportCfgProfile: vi.fn(),
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
    apiMock.cfgVersions.mockResolvedValue([]);
    apiMock.cs2RuntimeFiles.mockResolvedValue([
      {
        steamId64: "76561198000000001",
        path: "C:\\runtime.cfg",
        name: "runtime.cfg",
        size: 20,
        editable: true,
      },
    ]);
    apiMock.previewCs2RuntimeFile.mockResolvedValue("volume 0.5");
    apiMock.saveCfgProfile.mockResolvedValue(undefined);
    apiMock.exportCfgProfile.mockResolvedValue("C:\\exports\\autoexec.cfg");
    clipboardMock.writeText.mockResolvedValue(undefined);
  });

  it("opens in visual mode and synchronizes a control back to source/autosave", async () => {
    render(<Cs2Page notify={vi.fn()} />);
    await screen.findByDisplayValue("主配置");
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
    await screen.findByDisplayValue("主配置");
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
    await screen.findByDisplayValue("主配置");
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

  it("keeps auxiliary tools collapsed and opens runtime files read-only", async () => {
    const { container } = render(<Cs2Page notify={vi.fn()} />);
    await screen.findByDisplayValue("主配置");
    expect(container.querySelector("details.cfg-tools")).not.toHaveAttribute(
      "open",
    );

    fireEvent.click(screen.getByRole("button", { name: "运行文件" }));
    fireEvent.click(await screen.findByRole("button", { name: /runtime.cfg/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("运行文件只读预览")).toHaveAttribute(
        "readonly",
      ),
    );
    expect(screen.getByDisplayValue("volume 0.5")).toBeInTheDocument();
  });
});
