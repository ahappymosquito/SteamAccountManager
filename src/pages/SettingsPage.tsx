/** Steam configuration, project identity, safety boundaries, and recovery tools. */
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  GitBranch,
  KeyRound,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import {
  APP_ICON_PATH,
  APP_NAME,
  GITHUB_RELEASES_URL,
  GITHUB_REPOSITORY_URL,
} from "../lib/appMeta";
import type {
  AppError,
  PlatformCredentialStatus,
  UpdateInfo,
  UpdateProgress,
} from "../lib/types";

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败";

export function SettingsPage({
  notify,
  onConfigured,
  update,
  updateProgress,
  checkingUpdate = false,
  onCheckUpdate,
  onInstallUpdate,
}: {
  notify: (kind: "success" | "error", text: string) => void;
  onConfigured: () => void;
  update?: UpdateInfo;
  updateProgress?: UpdateProgress;
  checkingUpdate?: boolean;
  onCheckUpdate?: () => void;
  onInstallUpdate?: () => void;
}) {
  const [path, setPath] = useState("");
  const [timeout, setTimeoutValue] = useState(15);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState("未知");
  const [fiveEToken, setFiveEToken] = useState("");
  const [fiveEStatus, setFiveEStatus] = useState<PlatformCredentialStatus>();
  const [savingFiveE, setSavingFiveE] = useState(false);

  useEffect(() => {
    void api
      .settings()
      .then((settings) => {
        setPath(String(settings.steam_path ?? "").replace(/^"|"$/g, ""));
        setTimeoutValue(Number(settings.shutdown_timeout ?? 15));
      })
      .catch(() => {});
    void getVersion().then(setVersion).catch(() => setVersion("未知"));
    void api.platformCredentialStatus("5e").then(setFiveEStatus).catch(() => {});
  }, []);

  const choose = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择 Steam 安装目录",
    });
    if (typeof selected === "string") setPath(selected);
  };
  const auto = async () => {
    try {
      const found = await api.discoverSteam();
      if (found) setPath(found);
      else notify("error", "未自动发现 Steam，请手动选择目录");
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.setSteamPath(path);
      await api.setSetting("shutdown_timeout", timeout);
      notify("success", "Steam 设置已保存");
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
  const restore = async () => {
    if (!confirm("恢复最近一次 loginusers.vdf 备份？请先关闭 Steam。"))
      return;
    try {
      await api.restoreBackup();
      notify("success", "最近备份已恢复");
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
  const exportJson = async () => {
    try {
      const data = await api.exportData(false);
      await writeText(JSON.stringify(data, null, 2));
      notify("success", "导出 JSON 已复制到剪贴板");
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };
  const importJson = async () => {
    const text = prompt("粘贴本应用导出的 JSON");
    if (!text) return;
    try {
      const data = JSON.parse(text);
      const preview = await api.previewImport(data);
      if (preview.blockedFields.length) {
        notify("error", `发现危险字段：${preview.blockedFields.join(", ")}`);
        return;
      }
      if (
        confirm(
          `将新增 ${preview.added}、合并 ${preview.updated}、跳过 ${preview.skipped} 条。继续？`,
        )
      ) {
        await api.applyImport(data, false);
        notify("success", "资料导入完成");
        onConfigured();
      }
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };
  const updateBusy =
    updateProgress?.state === "downloading" ||
    updateProgress?.state === "installing";
  const updatePercent =
    updateProgress?.state === "downloading" && updateProgress.total
      ? Math.min(
          100,
          Math.round(
            (updateProgress.downloaded / updateProgress.total) * 100,
          ),
        )
      : undefined;
  const updateActionLabel = update?.portable
    ? "安装新版并转为安装版"
    : "更新并重启";

  return (
    <section>
      <header className="page-heading">
        <div>
          <h1>设置</h1>
          <p>Steam 路径、项目信息与账号切换安全边界。</p>
        </div>
      </header>
      <section className="settings-primary">
        <div className="section-heading">
          <h2>Steam</h2>
          <p>选择包含 steam.exe 和 config/loginusers.vdf 的安装目录。</p>
        </div>
        <label>
          Steam 安装目录
          <div className="input-row">
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            <button
              className="button secondary"
              onClick={() => void choose()}
            >
              <FolderOpen />
              浏览
            </button>
            <button className="button secondary" onClick={() => void auto()}>
              <RefreshCw />
              自动发现
            </button>
          </div>
        </label>
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
          {saving ? "正在保存" : "保存 Steam 设置"}
        </button>
      </section>
      <section className="fivee-credential" aria-labelledby="fivee-credential-title">
        <div className="section-heading">
          <h2 id="fivee-credential-title">
            <KeyRound />
            5E 查询凭据
          </h2>
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
      </section>
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
              onClick={() => void openExternal(GITHUB_RELEASES_URL)}
            >
              <ExternalLink />
              查看 Releases
            </button>
          </div>
        </div>
        <div className="app-update-section" aria-live="polite">
          <div>
            <h3>
              <Download />
              应用更新
            </h3>
            {update ? (
              <>
                <p>
                  可更新至 <strong>v{update.version}</strong>
                  {update.portable
                    ? "。当前为便携版，更新后将安装到当前用户目录。"
                    : "。安装完成后应用会自动重启。"}
                </p>
                {update.notes && (
                  <details className="update-notes">
                    <summary>查看版本说明</summary>
                    <p>{update.notes}</p>
                  </details>
                )}
              </>
            ) : (
              <p>当前版本 v{version}，可手动检查 GitHub Release。</p>
            )}
            {updateProgress && updateProgress.state !== "checking" && (
              <div className={`update-status ${updateProgress.state}`}>
                {updateProgress.state === "downloading" &&
                  `正在下载${updatePercent === undefined ? "" : ` ${updatePercent}%`}`}
                {updateProgress.state === "installing" && "正在安装更新"}
                {updateProgress.state === "completed" && "更新安装完成"}
                {updateProgress.state === "error" &&
                  (updateProgress.message || "更新失败，请重试")}
              </div>
            )}
          </div>
          <div className="app-update-actions">
            <button
              className="button secondary"
              disabled={checkingUpdate || updateBusy}
              onClick={onCheckUpdate}
            >
              <RefreshCw className={checkingUpdate ? "spin-icon" : undefined} />
              {checkingUpdate ? "正在检查" : "检查更新"}
            </button>
            {update && (
              <button
                className="button primary"
                disabled={updateBusy}
                onClick={onInstallUpdate}
              >
                {updateBusy && <RefreshCw className="spin-icon" />}
                {updateBusy ? "正在更新" : updateActionLabel}
              </button>
            )}
          </div>
        </div>
        <div className="safety-overview">
          <h3>
            <ShieldCheck />
            账号安全边界
          </h3>
          <p>
            本应用只切换 Steam 官方客户端已记住且本机仍有效的登录状态，不接触账号认证过程。
          </p>
          <ul>
            <li>
              不保存 Steam 密码、Cookie 或 Steam Guard
              密钥；可选的 5E Token 仅保存在 Windows 凭据管理器。
            </li>
            <li>
              不注入 Steam 或游戏进程，不读写进程内存，不绕过验证，也不操作反作弊系统。
            </li>
            <li>
              现有实现不包含通常与作弊封禁相关的技术行为，但本项目不能代表 Valve
              承诺绝对零风险。
            </li>
          </ul>
        </div>
      </section>
      <details className="advanced-tools">
        <summary>
          <span>
            <Database />
            高级与恢复
          </span>
          <small>备份、导入和导出</small>
          <ChevronDown />
        </summary>
        <div>
          <p>
            这些工具只处理本应用资料及本机 Steam
            配置备份，不能复制登录凭证到其他设备。
          </p>
          <button className="button danger" onClick={() => void restore()}>
            恢复最近备份
          </button>
          <button className="button secondary" onClick={() => void exportJson()}>
            复制导出 JSON
          </button>
          <button className="button secondary" onClick={() => void importJson()}>
            导入 JSON
          </button>
        </div>
      </details>
    </section>
  );
}
