/** Application version, switching preferences, backup recovery, and optional query credentials. */
import * as Dialog from "@radix-ui/react-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import {
  CircleHelp,
  Database,
  Download,
  ExternalLink,
  GitBranch,
  KeyRound,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { CDN_BASE_URL } from "../lib/cdn";
import {
  APP_ICON_PATH,
  APP_NAME,
  GITHUB_REPOSITORY_URL,
} from "../lib/appMeta";
import type {
  AppError,
  ImportPreview,
  PlatformCredentialStatus,
  RestoreSelection,
  UpdateInfo,
  UpdateProgress,
} from "../lib/types";

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败";
const credentialGuides = {
  "5e": {
    title: "如何获取 5E 查询凭据",
    officialUrl: "https://csgo.5eplay.com/",
    officialLabel: "打开 5E 官网",
    intro:
      "5E 没有公开的 API 凭据申请页。Bearer Token 来自你本人已登录的官方会话，而且是可选项。",
    steps: [
      "打开 5E 官方网站并登录自己的账号。",
      "如果本人会话的已认证网络请求显示 Authorization: Bearer …，只复制 Bearer 后面的 Token 值。若官方会话不提供该字段，保持留空即可继续匿名查询。",
      "粘贴并保存 Token。遇到 401/403 时应用会降级为匿名查询，需要时可从新的本人登录会话重新获取。",
    ],
  },
  perfectworld: {
    title: "如何获取完美平台查询凭据",
    officialUrl: "https://pvp.wanmei.com/",
    officialLabel: "打开完美平台官网",
    intro:
      "完美平台没有公开的 API 凭据申请页。Access Token 来自你本人已登录的官方平台会话。",
    steps: [
      "打开完美世界竞技平台官网，使用官方客户端登录自己的账号。",
      "在本人已认证会话的网络信息中找到 steam_cn_token Cookie 或 access_token 参数，只复制 Token 值，不复制完整 Cookie、请求或截图。",
      "将值粘贴到 Access Token 并保存。Token 过期后需要从新的本人登录会话重新获取。",
    ],
  },
} as const;

export function SettingsPage({
  notify,
  onConfigured,
  update,
}: {
  notify: (kind: "success" | "error", text: string) => void;
  onConfigured: () => void;
  update?: UpdateInfo;
  updateProgress?: UpdateProgress;
  checkingUpdate?: boolean;
  onCheckUpdate?: () => void;
  onInstallUpdate?: () => void;
}) {
  const [timeout, setTimeoutValue] = useState(15);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState("未知");
  const [fiveEToken, setFiveEToken] = useState("");
  const [fiveEStatus, setFiveEStatus] = useState<PlatformCredentialStatus>();
  const [savingFiveE, setSavingFiveE] = useState(false);
  const [perfectWorldToken, setPerfectWorldToken] = useState("");
  const [perfectWorldStatus, setPerfectWorldStatus] = useState<PlatformCredentialStatus>();
  const [savingPerfectWorld, setSavingPerfectWorld] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<{
    path: string;
    preview: ImportPreview;
  }>();
  const [restoreSelection, setRestoreSelection] = useState<RestoreSelection>({
    accounts: true,
    cfg: true,
    settings: true,
  });
  const [credentialHelp, setCredentialHelp] =
    useState<keyof typeof credentialGuides>();

  useEffect(() => {
    void api
      .settings()
      .then((settings) => {
        setTimeoutValue(Number(settings.shutdown_timeout ?? 15));
      })
      .catch(() => {});
    void getVersion().then(setVersion).catch(() => setVersion("未知"));
    void api.platformCredentialStatus("5e").then(setFiveEStatus).catch(() => {});
    void api.platformCredentialStatus("perfectworld").then(setPerfectWorldStatus).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.setSetting("shutdown_timeout", timeout);
      notify("success", "账号切换设置已保存");
      onConfigured();
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  const openExternal = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      notify("error", "无法打开链接，请检查系统默认浏览器");
    }
  };
  const restoreSteamBackup = async () => {
    if (!confirm("恢复最近一次 loginusers.vdf 备份？请先关闭 Steam。"))
      return;
    try {
      await api.restoreSteamBackup();
      notify("success", "Steam 切换配置备份已恢复");
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };
  const saveFiveEToken = async (remove = false) => {
    setSavingFiveE(true);
    try {
      await api.savePlatformCredential("5e", remove ? undefined : fiveEToken);
      setFiveEToken("");
      setFiveEStatus(await api.platformCredentialStatus("5e"));
      notify("success", remove ? "5E Token 已删除" : "5E Token 已安全保存");
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setSavingFiveE(false);
    }
  };
  const savePerfectWorldToken = async (remove = false) => {
    setSavingPerfectWorld(true);
    try {
      await api.savePlatformCredential("perfectworld", remove ? undefined : perfectWorldToken);
      setPerfectWorldToken("");
      setPerfectWorldStatus(await api.platformCredentialStatus("perfectworld"));
      notify("success", remove ? "完美平台 Token 已删除" : "完美平台 Token 已安全保存");
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setSavingPerfectWorld(false);
    }
  };
  const exportBackup = async () => {
    const date = new Date().toISOString().slice(0, 10);
    const selected = await saveDialog({
      title: "导出软件备份",
      defaultPath: `Steam-Account-Manager-${date}.sam-backup.json`,
      filters: [
        {
          name: "Steam Account Manager 备份",
          extensions: ["sam-backup.json", "json"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    setBackupBusy(true);
    try {
      const preview = await api.exportBackupFile(selected);
      notify(
        "success",
        `备份文件已导出，包含 ${preview.accountCount} 个账号和 ${preview.platformLinkCount} 条平台资料`,
      );
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBackupBusy(false);
    }
  };
  const restoreFromFile = async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "选择软件备份文件",
      filters: [
        {
          name: "Steam Account Manager 备份",
          extensions: ["sam-backup.json", "json"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    setBackupBusy(true);
    try {
      const preview = await api.previewBackupFile(selected);
      setRestoreSelection({ accounts: true, cfg: true, settings: true });
      setRestoreCandidate({ path: selected, preview });
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBackupBusy(false);
    }
  };
  const confirmRestore = async () => {
    if (!restoreCandidate) return;
    if (!Object.values(restoreSelection).some(Boolean)) {
      notify("error", "请至少选择一类要恢复的资料");
      return;
    }
    setBackupBusy(true);
    try {
      await api.restoreBackupFile(restoreCandidate.path, restoreSelection);
      setRestoreCandidate(undefined);
      notify("success", "所选软件资料已恢复，请重启应用使全部数据生效");
      onConfigured();
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBackupBusy(false);
    }
  };
  return (
    <section className="settings-page-layout">
      <header className="page-heading">
        <div>
          <h1>设置</h1>
          <p>版本更新、账号切换、备份恢复与平台查询凭据。</p>
        </div>
      </header>
      <section className="settings-primary">
        <div className="section-heading">
          <h2>账号切换</h2>
          <p>Steam 安装目录已移至“平台”页面统一配置。</p>
        </div>
        <label>
          关闭 Steam 等待超时（秒）
          <input
            type="number"
            min={5}
            max={120}
            value={timeout}
            onChange={(event) => setTimeoutValue(Number(event.target.value))}
          />
        </label>
        <button
          className="button primary settings-save"
          disabled={saving}
          onClick={() => void save()}
        >
          <Save />
          {saving ? "正在保存" : "保存切换设置"}
        </button>
      </section>
      <details className="fivee-credential credential-panel" aria-labelledby="fivee-credential-title">
        <summary>
          <span><KeyRound />5E 查询凭据</span>
          <small>{fiveEStatus?.configured ? "已配置" : "默认关闭"}</small>
        </summary>
        <div className="credential-panel-body">
        <div className="section-heading">
          <div className="credential-heading-row">
            <h2 id="fivee-credential-title">
              <KeyRound />
              5E 查询凭据
            </h2>
            <div className="credential-links">
              <button
                className="icon-button"
                aria-label="查看 5E Token 获取步骤"
                title="如何获取"
                onClick={() => setCredentialHelp("5e")}
              >
                <CircleHelp />
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  void openExternal(credentialGuides["5e"].officialUrl)
                }
              >
                <ExternalLink />
                打开官网
              </button>
            </div>
          </div>
          <p>
            不填写也会尽量匿名查询。Token 仅保存在 Windows 凭据管理器，不进入数据库、日志或导出文件。
          </p>
        </div>
        <div className="credential-status" role="status">
          <span className={fiveEStatus?.configured ? "configured" : ""} />
          {fiveEStatus?.configured
            ? fiveEStatus.expired
              ? "已配置，但可能已经过期"
              : "已安全配置"
            : "未配置，使用匿名查询"}
        </div>
        <label>
          Bearer Token
          <input
            type="password"
            autoComplete="off"
            value={fiveEToken}
            placeholder={fiveEStatus?.configured ? "输入新 Token 可替换现有凭据" : "可选"}
            onChange={(event) => setFiveEToken(event.target.value)}
          />
        </label>
        <div className="credential-actions">
          <button
            className="button primary"
            disabled={savingFiveE || !fiveEToken.trim()}
            onClick={() => void saveFiveEToken()}
          >
            <Save />
            {savingFiveE ? "正在保存" : "保存 Token"}
          </button>
          {fiveEStatus?.configured && (
            <button
              className="button danger"
              disabled={savingFiveE}
              onClick={() => void saveFiveEToken(true)}
            >
              <Trash2 />
              删除 Token
            </button>
          )}
        </div>
        </div>
      </details>
      <details className="fivee-credential credential-panel" aria-labelledby="perfectworld-credential-title">
        <summary>
          <span><KeyRound />完美平台查询凭据</span>
          <small>{perfectWorldStatus?.configured ? "已配置" : "默认关闭"}</small>
        </summary>
        <div className="credential-panel-body">
        <div className="section-heading">
          <div className="credential-heading-row">
            <h2 id="perfectworld-credential-title">
              <KeyRound />
              完美平台查询凭据
            </h2>
            <div className="credential-links">
              <button
                className="icon-button"
                aria-label="查看完美平台 Token 获取步骤"
                title="如何获取"
                onClick={() => setCredentialHelp("perfectworld")}
              >
                <CircleHelp />
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  void openExternal(credentialGuides.perfectworld.officialUrl)
                }
              >
                <ExternalLink />
                打开官网
              </button>
            </div>
          </div>
          <p>
            配置后，账号详情会使用 SteamID64 自动匹配完美平台，并读取赛季记录段位与分数。Token 仅保存在 Windows 凭据管理器。
          </p>
        </div>
        <div className="credential-status" role="status">
          <span className={perfectWorldStatus?.configured ? "configured" : ""} />
          {perfectWorldStatus?.configured
            ? perfectWorldStatus.expired
              ? "已配置，但可能已经过期"
              : "已安全配置，可自动匹配"
            : "未配置，暂不发起完美平台查询"}
        </div>
        <label>
          Access Token
          <input
            type="password"
            autoComplete="off"
            value={perfectWorldToken}
            placeholder={perfectWorldStatus?.configured ? "输入新 Token 可替换现有凭据" : "查询完美平台数据时必需"}
            onChange={(event) => setPerfectWorldToken(event.target.value)}
          />
        </label>
        <div className="credential-actions">
          <button
            className="button primary"
            disabled={savingPerfectWorld || !perfectWorldToken.trim()}
            onClick={() => void savePerfectWorldToken()}
          >
            <Save />
            {savingPerfectWorld ? "正在保存" : "保存完美 Token"}
          </button>
          {perfectWorldStatus?.configured && (
            <button
              className="button danger"
              disabled={savingPerfectWorld}
              onClick={() => void savePerfectWorldToken(true)}
            >
              <Trash2 />
              删除完美 Token
            </button>
          )}
        </div>
        </div>
      </details>
      <Dialog.Root
        open={Boolean(credentialHelp)}
        onOpenChange={(open) => !open && setCredentialHelp(undefined)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog compact credential-help-dialog">
            {credentialHelp && (
              <>
                <header>
                  <div>
                    <Dialog.Title>
                      {credentialGuides[credentialHelp].title}
                    </Dialog.Title>
                    <Dialog.Description>
                      {credentialGuides[credentialHelp].intro}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close className="icon-button" aria-label="关闭凭据帮助">
                    <X />
                  </Dialog.Close>
                </header>
                <ol>
                  {credentialGuides[credentialHelp].steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="credential-security-note">
                  Token 等同于会话凭据。不要分享给他人，不要上传截图、Cookie
                  或完整网络请求。
                </p>
                <footer>
                  <button
                    className="button secondary"
                    onClick={() =>
                      void openExternal(
                        credentialGuides[credentialHelp].officialUrl,
                      )
                    }
                  >
                    <ExternalLink />
                    {credentialGuides[credentialHelp].officialLabel}
                  </button>
                  <Dialog.Close className="button primary">知道了</Dialog.Close>
                </footer>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <section className="about-safety" aria-labelledby="about-title">
        <div className="about-header">
          <img src={APP_ICON_PATH} alt={`${APP_NAME} 图标`} />
          <div>
            <h2 id="about-title">{APP_NAME}</h2>
            <p>
              当前版本 <strong>v{version}</strong>，非 Valve 官方工具
            </p>
          </div>
          <div className="about-actions">
            <button
              className="button secondary"
              onClick={() => void openExternal(GITHUB_REPOSITORY_URL)}
            >
              <GitBranch />
              查看 GitHub
            </button>
            <button
              className="button secondary"
              onClick={() => void openExternal(CDN_BASE_URL)}
            >
              <ExternalLink />
              下载安装包
            </button>
          </div>
        </div>
        <div className="app-update-section">
          <div>
            <h3>
              <Download />
              应用更新
            </h3>
            <p>
              检查更新和安装都在左侧栏底部。点「更新」后自动下载、安装并重启，无需再选其他选项。
              {update ? ` 当前可更新至 v${update.version}。` : ` 当前版本 v${version}。`}
            </p>
          </div>
        </div>
      </section>
      <section className="advanced-tools backup-tools" aria-labelledby="backup-tools-title">
        <div className="section-heading">
          <h2 id="backup-tools-title"><Database />备份与恢复</h2>
          <p>
            整机搬家用软件备份；网吧请到「外出资料」用自己的名字和口令打开，或导入资料包。备份是明文 JSON，含平台登录账号和密码，不含查询 Token 或 Steam 密码。
            从文件恢复前，当前资料会自动保存在应用数据目录。未匹配的备份账号不会进入切号列表。
          </p>
        </div>
        <div className="backup-actions">
          <button
            className="button secondary"
            disabled={backupBusy}
            onClick={() => void exportBackup()}
          >
            <Download />
            导出备份文件
          </button>
          <button
            className="button secondary"
            disabled={backupBusy}
            onClick={() => void restoreFromFile()}
          >
            <Upload />
            从备份文件恢复
          </button>
          <button
            className="button danger"
            disabled={backupBusy}
            onClick={() => void restoreSteamBackup()}
          >
            恢复 Steam 切换配置备份
          </button>
        </div>
      </section>
      <Dialog.Root
        open={Boolean(restoreCandidate)}
        onOpenChange={(open) => !open && !backupBusy && setRestoreCandidate(undefined)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog restore-selection-dialog">
            <header>
              <div>
                <Dialog.Title>选择要恢复的资料</Dialog.Title>
                <Dialog.Description>
                  账号资料只会恢复到本机已匹配的 Steam 账号。
                </Dialog.Description>
              </div>
              <Dialog.Close className="icon-button" aria-label="关闭恢复选择">
                <X />
              </Dialog.Close>
            </header>
            {restoreCandidate && (
              <div className="restore-selection-list">
                <label>
                  <input
                    type="checkbox"
                    checked={restoreSelection.accounts}
                    onChange={(event) =>
                      setRestoreSelection({
                        ...restoreSelection,
                        accounts: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong>账号与平台资料</strong>
                    <small>
                      匹配 {restoreCandidate.preview.matchedAccountCount} 个本机账号，
                      {restoreCandidate.preview.matchedPlatformLinkCount} 条平台资料
                      {restoreCandidate.preview.skippedAccountCount > 0
                        ? `，忽略 ${restoreCandidate.preview.skippedAccountCount} 个未匹配账号`
                        : ""}
                    </small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={restoreSelection.cfg}
                    onChange={(event) =>
                      setRestoreSelection({
                        ...restoreSelection,
                        cfg: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong>CFG 方案、账号分配与运行记录</strong>
                    <small>{restoreCandidate.preview.cfgProfileCount} 个 CFG 方案</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={restoreSelection.settings}
                    onChange={(event) =>
                      setRestoreSelection({
                        ...restoreSelection,
                        settings: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong>软件设置与平台程序</strong>
                    <small>{restoreCandidate.preview.settingCount} 条设置</small>
                  </span>
                </label>
              </div>
            )}
            <footer>
              <Dialog.Close className="button secondary" disabled={backupBusy}>
                取消
              </Dialog.Close>
              <button
                className="button primary"
                disabled={
                  backupBusy || !Object.values(restoreSelection).some(Boolean)
                }
                onClick={() => void confirmRestore()}
              >
                <Upload />
                {backupBusy ? "正在恢复" : "恢复所选资料"}
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
