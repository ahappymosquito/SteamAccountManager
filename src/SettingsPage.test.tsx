/** Settings tests for Steam configuration, project safety details, links, and recovery tools. */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  setSteamPath: vi.fn(),
  setSetting: vi.fn(),
  discoverSteam: vi.fn(),
  getVersion: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("./lib/api", () => ({
  api: {
    ...mocks,
    restoreBackup: vi.fn(),
    exportData: vi.fn(),
    previewImport: vi.fn(),
    applyImport: vi.fn(),
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));

import { SettingsPage } from "./App";

describe("SettingsPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue({
      steam_path: "D:\\Steam",
      shutdown_timeout: 20,
    });
    mocks.setSteamPath.mockResolvedValue(undefined);
    mocks.setSetting.mockResolvedValue(undefined);
    mocks.getVersion.mockResolvedValue("0.4.2");
    mocks.openUrl.mockResolvedValue(undefined);
  });

  it("persists Steam path and timeout while recovery stays low priority", async () => {
    const configured = vi.fn();
    render(<SettingsPage notify={vi.fn()} onConfigured={configured} />);

    expect(
      await screen.findByDisplayValue("D:\\Steam"),
    ).toBeInTheDocument();
    expect(screen.getByText("高级与恢复").closest("details")).not.toHaveAttribute(
      "open",
    );
    fireEvent.click(screen.getByRole("button", { name: "保存 Steam 设置" }));

    await waitFor(() =>
      expect(mocks.setSteamPath).toHaveBeenCalledWith("D:\\Steam"),
    );
    expect(mocks.setSetting).toHaveBeenCalledWith("shutdown_timeout", 20);
    expect(configured).toHaveBeenCalled();
  });

  it("shows the local version, safety boundaries, and official project links", async () => {
    render(<SettingsPage notify={vi.fn()} onConfigured={vi.fn()} />);

    expect(await screen.findByText("v0.4.2")).toBeInTheDocument();
    expect(
      screen.getByText(/不注入 Steam 或游戏进程/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/不能代表 Valve 承诺绝对零风险/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 GitHub" }));
    await waitFor(() =>
      expect(mocks.openUrl).toHaveBeenCalledWith(
        "https://github.com/ahappymosquito/SteamAccountManager",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 Releases" }));
    await waitFor(() =>
      expect(mocks.openUrl).toHaveBeenCalledWith(
        "https://github.com/ahappymosquito/SteamAccountManager/releases",
      ),
    );
  });

  it("keeps project links available when the runtime version is unavailable", async () => {
    mocks.getVersion.mockRejectedValueOnce(new Error("version unavailable"));
    render(<SettingsPage notify={vi.fn()} onConfigured={vi.fn()} />);

    expect(await screen.findByText("v未知")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看 GitHub" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "查看 Releases" }),
    ).toBeEnabled();
  });
});
