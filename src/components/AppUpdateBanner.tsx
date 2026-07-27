/** Non-blocking application update notice and installation progress. */
import { Download, RefreshCw, X } from "lucide-react";
import type { UpdateInfo, UpdateProgress } from "../lib/types";

const progressText = (progress?: UpdateProgress) => {
  if (!progress) return undefined;
  if (progress.state === "downloading") {
    if (progress.total) {
      return `正在下载 ${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}%`;
    }
    return "正在下载更新";
  }
  if (progress.state === "installing") return "正在安装更新";
  if (progress.state === "completed") return "更新安装完成";
  if (progress.state === "error") return progress.message || "更新失败";
  return "正在检查更新";
};

export function AppUpdateBanner({
  update,
  progress,
  onInstall,
  onDismiss,
  onDetails,
}: {
  update: UpdateInfo;
  progress?: UpdateProgress;
  onInstall: () => void;
  onDismiss: () => void;
  onDetails: () => void;
}) {
  const busy =
    progress?.state === "downloading" || progress?.state === "installing";
  const status = progressText(progress);
  const label = update.portable
    ? "安装新版并转为安装版"
    : "更新并重启";

  return (
    <section className="update-banner" aria-live="polite">
      <div className="update-banner-copy">
        <Download aria-hidden="true" />
        <div>
          <strong>发现新版本 v{update.version}</strong>
          <span>{status || "更新包来自项目 GitHub Release，并会在安装前验证签名。"}</span>
        </div>
      </div>
      <div className="update-banner-actions">
        <button className="button secondary" onClick={onDetails} disabled={busy}>
          查看详情
        </button>
        <button className="button primary" onClick={onInstall} disabled={busy}>
          {busy && <RefreshCw className="spin-icon" aria-hidden="true" />}
          {status || label}
        </button>
        <button
          className="icon-button"
          aria-label="稍后更新"
          onClick={onDismiss}
          disabled={busy}
        >
          <X />
        </button>
      </div>
    </section>
  );
}
