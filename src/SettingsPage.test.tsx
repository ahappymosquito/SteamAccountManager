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
    });
    mocks.previewBackupFile.mockResolvedValue({
      schemaVersion: 2,
      exportedAt: "2026-07-30T00:00:00Z",
      accountCount: 2,
      platformLinkCount: 3,
      cfgProfileCount: 1,
    });
    mocks.restoreBackupFile.mockResolvedValue(undefined);
    mocks.restoreSteamBackup.mockResolvedValue(undefined);
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

  it("previews and restores a selected backup after confirmation", async () => {
    const notify = vi.fn();
    const configured = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
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
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("2 个账号、3 条平台资料和 1 个 CFG 方案"),
    );
    await waitFor(() =>
      expect(mocks.restoreBackupFile).toHaveBeenCalledWith(
        "D:\\backup.sam-backup.json",
      ),
    );
    expect(configured).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "success",
      "软件资料已恢复，请重启应用使全部数据生效",
    );
    confirmSpy.mockRestore();
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

  it("shows signed update details and portable conversion action", async () => {
    const onCheckUpdate = vi.fn();
    const onInstallUpdate = vi.fn();
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
        updateProgress={{
          state: "downloading",
          downloaded: 25,
          total: 100,
        }}
        onCheckUpdate={onCheckUpdate}
        onInstallUpdate={onInstallUpdate}
      />,
    );

    expect(await screen.findByText("v0.5.0")).toBeInTheDocument();
    expect(screen.getByText(/当前为便携版/)).toBeInTheDocument();
    expect(screen.getByText("正在下载 25%")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /正在更新/ }),
    ).toBeDisabled();
  });
});
