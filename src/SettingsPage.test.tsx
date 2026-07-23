/** Settings tests for Steam configuration and intentionally collapsed recovery tools. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  setSteamPath: vi.fn(),
  setSetting: vi.fn(),
  discoverSteam: vi.fn(),
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

import { SettingsPage } from "./App";

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue({
      steam_path: "D:\\Steam",
      shutdown_timeout: 20,
    });
    mocks.setSteamPath.mockResolvedValue(undefined);
    mocks.setSetting.mockResolvedValue(undefined);
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
});
