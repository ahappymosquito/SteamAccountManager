/** Regression tests for platform detection summaries and context-aware software actions. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  softwareStatuses: vi.fn(),
  downloadProgress: vi.fn(),
  links: vi.fn(),
  openOfficialUrl: vi.fn(),
  launchSoftware: vi.fn(),
  discoverPlatformApps: vi.fn(),
  savePlatformApp: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    ...mocks,
    startSoftwareDownload: vi.fn(),
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openPath }));
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
    mocks.discoverPlatformApps.mockResolvedValue([]);
    mocks.savePlatformApp.mockResolvedValue(undefined);
    mocks.openPath.mockResolvedValue(null);
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
    expect(
      screen.queryByRole("button", { name: "选择路径" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the path chooser as a fallback for an undetected platform", async () => {
    render(<PlatformsPage accounts={[]} notify={vi.fn()} />);

    expect(
      await screen.findByRole("button", { name: "选择路径" }),
    ).toBeInTheDocument();
  });

  it("allows an undetected TeamSpeak client to be selected manually", async () => {
    const executable =
      "D:\\Voice\\TeamSpeak 3 Client\\ts3client_win64.exe";
    mocks.softwareStatuses.mockResolvedValue([
      {
        code: "teamspeak3",
        name: "TeamSpeak 3",
        installed: false,
        downloadMode: "managed",
        officialUrl: "https://www.teamspeak.com/en/downloads/",
      },
    ]);
    mocks.openPath.mockResolvedValue(executable);

    render(<PlatformsPage accounts={[]} notify={vi.fn()} />);
    (await screen.findByRole("button", { name: "选择路径" })).click();

    await waitFor(() =>
      expect(mocks.savePlatformApp).toHaveBeenCalledWith({
        platformCode: "teamspeak3",
        name: "TeamSpeak 3",
        executablePath: executable,
        arguments: [],
        workingDirectory: "D:\\Voice\\TeamSpeak 3 Client",
        prelaunchCheck: true,
      }),
    );
  });

  it("reports the final installed software count including TeamSpeak", async () => {
    const notify = vi.fn();
    mocks.discoverPlatformApps.mockResolvedValue([
      {
        platformCode: "5e",
        name: "5E 对战平台",
        executablePath: "C:\\Program Files\\5EClient\\5EClient.exe",
        arguments: [],
        workingDirectory: "C:\\Program Files\\5EClient",
        prelaunchCheck: true,
      },
    ]);
    mocks.softwareStatuses.mockResolvedValue([
      {
        code: "perfectworld",
        name: "完美世界竞技平台",
        installed: true,
        executablePath: "C:\\PerfectWorld\\PerfectWorld.exe",
        downloadMode: "managed",
        officialUrl: "https://pvp.wanmei.com/",
      },
      {
        code: "5e",
        name: "5E 对战平台",
        installed: true,
        executablePath: "C:\\Program Files\\5EClient\\5EClient.exe",
        downloadMode: "browser_fallback",
        officialUrl: "https://arena.5eplay.com/download/latest",
      },
      {
        code: "teamspeak3",
        name: "TeamSpeak 3",
        installed: true,
        executablePath:
          "C:\\Program Files\\TeamSpeak 3 Client\\ts3client_win64.exe",
        downloadMode: "managed",
        officialUrl: "https://www.teamspeak.com/en/downloads/",
      },
    ]);

    render(<PlatformsPage accounts={[]} notify={notify} />);
    await screen.findByText("TeamSpeak 3");
    screen.getByRole("button", { name: "重新检测" }).click();

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("success", "检测到 3 个已安装软件"),
    );
  });
});
