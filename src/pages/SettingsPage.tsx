/** Steam configuration, project identity, safety boundaries, and recovery tools. */
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  Database,
  ExternalLink,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { api } from "../lib/api";
import {
  APP_ICON_PATH,
  APP_NAME,
  GITHUB_RELEASES_URL,
  GITHUB_REPOSITORY_URL,
} from "../lib/appMeta";
import type { AppError } from "../lib/types";

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败";

export function SettingsPage({
  notify,
  onConfigured,
}: {
  notify: (kind: "success" | "error", text: string) => void;
  onConfigured: () => void;
}) {
  const [path, setPath] = useState("");
  const [timeout, setTimeoutValue] = useState(15);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState("未知");

  useEffect(() => {
    void api
      .settings()
      .then((settings) => {
        setPath(String(settings.steam_path ?? "").replace(/^"|"$/g, ""));
        setTimeoutValue(Number(settings.shutdown_timeout ?? 15));
      })
      .catch(() => {});
    void getVersion().then(setVersion).catch(() => setVersion("未知"));
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
              不保存或传递密码、Cookie、Token、Steam Guard
              密钥及其他认证数据。
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
