/** Settings discovery tests for one-click platform and CS2 configuration detection. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverPlatformApps: vi.fn(),
  discoverCs2Configs: vi.fn(),
  platformApps: vi.fn(),
  savePlatformApp: vi.fn(),
  settings: vi.fn(),
}));

vi.mock("./lib/api", () => ({
  api: {
    ...mocks,
    setSteamPath: vi.fn(),
    setSetting: vi.fn(),
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

import { SettingsPage } from "./App";

describe("SettingsPage local discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue({});
    mocks.platformApps.mockResolvedValue([]);
    mocks.discoverCs2Configs.mockResolvedValue([]);
    mocks.savePlatformApp.mockResolvedValue(undefined);
  });

  it("detects and persists platform executables and refreshes CS2 cfg results", async () => {
    const app = {
      platformCode: "5e",
      name: "5E",
      executablePath: "D:\\5EPlay\\app\\5EClient.exe",
      arguments: [],
      workingDirectory: "D:\\5EPlay\\app",
      prelaunchCheck: true,
    };
    mocks.discoverPlatformApps.mockResolvedValue([app]);
    mocks.platformApps.mockResolvedValueOnce([]).mockResolvedValueOnce([app]);
    mocks.discoverCs2Configs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          steamId64: "76561198000000000",
          path: "D:\\Steam\\userdata\\39734272\\730\\local\\cfg",
          fileCount: 2,
        },
      ]);

    render(<SettingsPage notify={vi.fn()} onConfigured={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "一键检测并配置" }));

    await waitFor(() => expect(mocks.savePlatformApp).toHaveBeenCalledWith(app));
    expect(await screen.findByText("1 组")).toBeInTheDocument();
  });
});
