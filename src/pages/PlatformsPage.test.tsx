/** Regression tests for concise platform download and completion states. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  softwareStatuses: vi.fn(),
  downloadProgress: vi.fn(),
  links: vi.fn(),
  openOfficialUrl: vi.fn(),
  launchSoftware: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    ...mocks,
    discoverPlatformApps: vi.fn(),
    savePlatformApp: vi.fn(),
    startSoftwareDownload: vi.fn(),
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { PlatformsPage } from "./PlatformsPage";

describe("PlatformsPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.links.mockResolvedValue([]);
    mocks.softwareStatuses.mockResolvedValue([
      {
        code: "5e",
        name: "5E 对战平台",
        installed: false,
        downloadMode: "browser_fallback",
        officialUrl: "https://arena.5eplay.com/download/latest",
      },
    ]);
    mocks.downloadProgress.mockResolvedValue([
      {
        code: "5e",
        state: "completed",
        downloaded: 0,
        message: "安装程序已结束，安装包已删除",
      },
    ]);
    mocks.openOfficialUrl.mockResolvedValue(undefined);
    mocks.launchSoftware.mockResolvedValue(undefined);
  });

  it("shows 5E as an official-site action and hides completed task chatter", async () => {
    render(<PlatformsPage accounts={[]} notify={vi.fn()} />);
    expect(
      await screen.findByRole("button", { name: "打开 5E 官网" }),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "打开 5E 官网" }).click();
    expect(mocks.openOfficialUrl).toHaveBeenCalledWith("5e");
    expect(
      screen.queryByText("安装程序已结束，安装包已删除"),
    ).not.toBeInTheDocument();
  });

  it("replaces the download action with launch when software is installed", async () => {
    mocks.softwareStatuses.mockResolvedValue([
      {
        code: "5e",
        name: "5E 对战平台",
        installed: true,
        executablePath: "C:\\5E\\5EClient.exe",
        downloadMode: "browser_fallback",
        officialUrl: "https://arena.5eplay.com/download/latest",
      },
    ]);

    render(<PlatformsPage accounts={[]} notify={vi.fn()} />);
    const launch = await screen.findByRole("button", { name: "启动软件" });
    launch.click();

    expect(mocks.launchSoftware).toHaveBeenCalledWith("5e");
    expect(
      screen.queryByRole("button", { name: "打开 5E 官网" }),
    ).not.toBeInTheDocument();
  });
});
