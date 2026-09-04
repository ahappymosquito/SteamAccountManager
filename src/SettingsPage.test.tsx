/** Settings tests for switching preferences, project links, credentials, and recovery tools. */
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
  platformCredentialStatus: vi.fn(),
  savePlatformCredential: vi.fn(),
  openDialog: vi.fn(),
  saveDialog: vi.fn(),
  exportBackupFile: vi.fn(),
  previewBackupFile: vi.fn(),
  restoreBackupFile: vi.fn(),
  restoreSteamBackup: vi.fn(),
}));

vi.mock("./lib/api", () => ({
  api: {
    ...mocks,
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.openDialog,
  save: mocks.saveDialog,
}));
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
    mocks.platformCredentialStatus.mockResolvedValue({
      platformCode: "5e",
      configured: false,
      expired: false,
    });
    mocks.savePlatformCredential.mockResolvedValue(undefined);
    mocks.openDialog.mockResolvedValue(null);
    mocks.saveDialog.mockResolvedValue(null);
    mocks.exportBackupFile.mockResolvedValue({
      schemaVersion: 2,
      exportedAt: "2026-07-30T00:00:00Z",
      accountCount: 2,
      platformLinkCount: 3,
      cfgProfileCount: 1,
      matchedAccountCount: 2,
      skippedAccountCount: 0,
      matchedPlatformLinkCount: 3,
      settingCount: 4,
    });
    mocks.previewBackupFile.mockResolvedValue({
      schemaVersion: 2,
      exportedAt: "2026-07-30T00:00:00Z",
      accountCount: 2,
      platformLinkCount: 3,
      cfgProfileCount: 1,
      matchedAccountCount: 1,
      skippedAccountCount: 1,
      matchedPlatformLinkCount: 2,
      settingCount: 4,
    });
    mocks.restoreBackupFile.mockResolvedValue(undefined);
    mocks.restoreSteamBackup.mockResolvedValue(undefined);
  });

  it("keeps version first, unifies backup tools, and collapses credentials at the bottom", async () => {
    const configured = vi.fn();
    render(<SettingsPage notify={vi.fn()} onConfigured={configured} />);

    await screen.findByText("v0.4.2");
    expect(screen.queryByDisplayValue("D:\\Steam")).not.toBeInTheDocument();
    expect(screen.getByText("备份与恢复")).toBeInTheDocument();
    expect(screen.getAllByText("5E 查询凭据")[0].closest("details")).not.toHaveAttribute("open");
    expect(screen.getAllByText("完美平台查询凭据")[0].closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "保存切换设置" }));

    expect(mocks.setSteamPath).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mocks.setSetting).toHaveBeenCalledWith("shutdown_timeout", 20);
      expect(configured).toHaveBeenCalled();
    });
  });

  it("shows the local version and official project links", async () => {
    render(<SettingsPage notify={vi.fn()} onConfigured={vi.fn()} />);

    expect(await screen.findByText("v0.4.2")).toBeInTheDocument();
    expect(screen.queryByText("账号安全边界")).not.toBeInTheDocument();
    expect(screen.queryByText(/不保存 Steam 密码/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 GitHub" }));
    await waitFor(() =>
      expect(mocks.openUrl).toHaveBeenCalledWith(
        "https://github.com/ahappymosquito/SteamAccountManager",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "下载安装包" }));
    await waitFor(() =>
      expect(mocks.openUrl).toHaveBeenCalledWith("https://cdn.qrqto.club"),
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
      screen.getByRole("button", { name: "下载安装包" }),
    ).toBeEnabled();
  });

  it("stores and removes the optional 5E token through the credential API", async () => {
    const notify = vi.fn();
    mocks.platformCredentialStatus
      .mockResolvedValueOnce({
        platformCode: "5e",
        configured: false,
        expired: false,
      })
      .mockResolvedValue({
        platformCode: "5e",
        configured: true,
        expired: false,
      });
    render(<SettingsPage notify={notify} onConfigured={vi.fn()} />);

    const token = await screen.findByLabelText("Bearer Token");
    fireEvent.change(token, { target: { value: "secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Token" }));

    await waitFor(() =>
      expect(mocks.savePlatformCredential).toHaveBeenCalledWith(
        "5e",
        "secret-token",
      ),
    );
    expect(notify).toHaveBeenCalledWith("success", "5E Token 已安全保存");

    fireEvent.click(await screen.findByRole("button", { name: "删除 Token" }));
    await waitFor(() =>
      expect(mocks.savePlatformCredential).toHaveBeenCalledWith(
        "5e",
        undefined,
      ),
    );
  });

  it("opens accessible credential guidance and first-party platform links", async () => {
    render(<SettingsPage notify={vi.fn()} onConfigured={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "查看 5E Token 获取步骤",
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "如何获取 5E 查询凭据" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/没有公开的 API 凭据申请页/),
    ).toBeInTheDocument();
    expect(screen.getByText(/继续匿名查询/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开 5E 官网" }));
    await waitFor(() =>
      expect(mocks.openUrl).toHaveBeenCalledWith("https://csgo.5eplay.com/"),
    );

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "查看完美平台 Token 获取步骤",
      }),
    );
    expect(
      screen.getByText(/steam_cn_token Cookie 或 access_token 参数/),
    ).toBeInTheDocument();
  });

  it("exports a plaintext backup to the selected file", async () => {
    const notify = vi.fn();
    mocks.saveDialog.mockResolvedValue("D:\\backup.sam-backup.json");
    render(<SettingsPage notify={notify} onConfigured={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "导出备份文件" }),
    );

    await waitFor(() =>
      expect(mocks.exportBackupFile).toHaveBeenCalledWith(
        "D:\\backup.sam-backup.json",
      ),
    );
    expect(notify).toHaveBeenCalledWith(
      "success",
      "备份文件已导出，包含 2 个账号和 3 条平台资料",
    );
  });

  it("previews matching accounts and restores only selected backup categories", async () => {
    const notify = vi.fn();
    const configured = vi.fn();
    mocks.openDialog.mockResolvedValue("D:\\backup.sam-backup.json");
    render(
      <SettingsPage notify={notify} onConfigured={configured} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "从备份文件恢复" }),
    );

    await waitFor(() =>
      expect(mocks.previewBackupFile).toHaveBeenCalledWith(
        "D:\\backup.sam-backup.json",
      ),
    );
    expect(
      await screen.findByRole("dialog", { name: "选择要恢复的资料" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/匹配 1 个本机账号/)).toBeInTheDocument();
    expect(screen.getByText(/忽略 1 个未匹配账号/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/CFG 方案、账号分配与运行记录/));
    fireEvent.click(screen.getByRole("button", { name: "恢复所选资料" }));
    await waitFor(() =>
      expect(mocks.restoreBackupFile).toHaveBeenCalledWith(
        "D:\\backup.sam-backup.json",
        { accounts: true, cfg: false, settings: true },
      ),
    );
    expect(configured).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "success",
      "所选软件资料已恢复，请重启应用使全部数据生效",
    );
  });

  it("does nothing when backup file selection is cancelled", async () => {
    render(<SettingsPage notify={vi.fn()} onConfigured={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "从备份文件恢复" }),
    );

    await waitFor(() => expect(mocks.openDialog).toHaveBeenCalled());
    expect(mocks.previewBackupFile).not.toHaveBeenCalled();
    expect(mocks.restoreBackupFile).not.toHaveBeenCalled();
  });

  it("points users to the sidebar for one-click updates", async () => {
    render(
      <SettingsPage
        notify={vi.fn()}
        onConfigured={vi.fn()}
        update={{
          currentVersion: "0.4.3",
          version: "0.5.0",
          notes: "新增自动更新",
          portable: true,
        }}
      />,
    );

    expect(await screen.findByText(/当前可更新至 v0.5.0/)).toBeInTheDocument();
    expect(screen.getByText(/左侧栏底部/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /转为安装版/ })).not.toBeInTheDocument();
  });
});
