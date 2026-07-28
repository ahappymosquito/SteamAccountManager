/** Dense platform installation controls and synchronized Steam account associations. */
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FolderSearch,
  Play,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import type {
  Account,
  AppError,
  DownloadProgress,
  PlatformApp,
  PlatformLink,
  SoftwareStatus,
} from "../lib/types";

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败";
const labels: Record<string, string> = {
  perfectworld: "完美世界",
  "5e": "5E",
};

const officialIcons: Record<SoftwareStatus["code"], string> = {
  perfectworld: "/platforms/perfectworld.ico",
  "5e": "/platforms/5e.png",
  teamspeak3: "/platforms/teamspeak.png",
};

export function PlatformsPage({
  accounts,
  notify,
}: {
  accounts: Account[];
  notify: (kind: "success" | "error", text: string) => void;
}) {
  const [software, setSoftware] = useState<SoftwareStatus[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [links, setLinks] = useState<Record<string, PlatformLink[]>>({});
  const [detecting, setDetecting] = useState(false);
  const [launching, setLaunching] = useState<string>();

  const load = async () => {
    const [statuses, downloads, accountLinks] = await Promise.all([
      api.softwareStatuses(),
      api.downloadProgress(),
      Promise.all(
        accounts.map(
          async (account) =>
            [account.id, await api.links(account.id)] as const,
        ),
      ),
    ]);
    setSoftware(statuses);
    setProgress(
      Object.fromEntries(
        downloads
          .filter((item) => item.state !== "completed")
          .map((item) => [item.code, item]),
      ),
    );
    setLinks(Object.fromEntries(accountLinks));
    return statuses;
  };

  useEffect(() => {
    void load().catch((error) => notify("error", errorMessage(error)));
    let unlisten: (() => void) | undefined;
    void listen<DownloadProgress>("software-download-progress", (event) => {
      const item = event.payload;
      setProgress((current) => {
        if (item.state === "completed") {
          const next = { ...current };
          delete next[item.code];
          return next;
        }
        return { ...current, [item.code]: item };
      });
      if (item.state === "completed") void load();
    }).then((value) => {
      unlisten = value;
    });
    return () => unlisten?.();
  }, [accounts.length]);

  const detect = async () => {
    setDetecting(true);
    try {
      const found = await api.discoverPlatformApps();
      await Promise.all(found.map((item) => api.savePlatformApp(item)));
      const statuses = await load();
      const installed = statuses.filter((item) => item.installed).length;
      notify("success", `检测到 ${installed} 个已安装软件`);
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setDetecting(false);
    }
  };

  const choose = async (item: SoftwareStatus) => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Windows 程序", extensions: ["exe"] }],
      title: `选择${item.name}启动程序`,
    });
    if (typeof selected !== "string") return;
    const app: PlatformApp = {
      platformCode: item.code as PlatformApp["platformCode"],
      name: item.name,
      executablePath: selected,
      arguments: [],
      workingDirectory: selected.replace(/[\\/][^\\/]+$/, ""),
      prelaunchCheck: true,
    };
    try {
      await api.savePlatformApp(app);
      await load();
      notify("success", `${item.name}路径已保存`);
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const download = async (item: SoftwareStatus) => {
    if (item.code === "5e") {
      try {
        await api.openOfficialUrl("5e");
      } catch (error) {
        notify("error", errorMessage(error));
      }
      return;
    }
    try {
      await api.startSoftwareDownload(item.code);
    } catch (error) {
      const appError = error as AppError;
      if (appError.code === "DOWNLOAD_BROWSER_REQUIRED") {
        await api.openOfficialUrl(item.code);
      } else {
        notify("error", errorMessage(error));
      }
    }
  };

  const launch = async (item: SoftwareStatus) => {
    setLaunching(item.code);
    try {
      await api.launchSoftware(item.code);
      notify("success", `${item.name}已启动`);
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setLaunching(undefined);
    }
  };

  const grouped = useMemo(
    () =>
      Object.fromEntries(
        ["perfectworld", "5e"].map((code) => [
          code,
          accounts
            .filter((account) =>
              (account.platformCodes || []).includes(
                code as "perfectworld" | "5e",
              ),
            )
            .map((account) => ({
              account,
              links: (links[account.id] || []).filter(
                (link) => link.platformCode === code,
              ),
            })),
        ]),
      ),
    [accounts, links],
  );
  const linkedCodes = (["perfectworld", "5e"] as const).filter(
    (code) => grouped[code].length,
  );

  return (
    <section>
      <header className="page-heading">
        <div>
          <h1>平台</h1>
          <p>客户端与账号关联</p>
        </div>
        <button
          className="button secondary"
          disabled={detecting}
          onClick={() => void detect()}
        >
          <RefreshCw />
          {detecting ? "检测中" : "重新检测"}
        </button>
      </header>

      <section className="software-manager">
        <div className="section-heading">
          <h2>软件</h2>
        </div>
        {software.map((item) => {
          const task = progress[item.code];
          const active =
            task &&
            ["starting", "downloading", "installing"].includes(task.state);
          const percent = task?.total
            ? Math.min(100, Math.round((task.downloaded / task.total) * 100))
            : undefined;
          const showTask = task && task.state !== "completed";
          return (
            <article className="software-row" key={item.code}>
              <div
                className={`software-icon ${item.code}`}
                aria-hidden="true"
              >
                <img src={officialIcons[item.code]} alt="" />
              </div>
              <div className="software-info">
                <h3>{item.name}</h3>
                {item.installed && item.executablePath && (
                  <p title={item.executablePath}>{item.executablePath}</p>
                )}
                {showTask && (
                  <div className={`download-state ${task.state}`}>
                    {active && (
                      <div>
                        <i
                          style={{
                            width: `${percent ?? (active ? 18 : 0)}%`,
                          }}
                        />
                      </div>
                    )}
                    <span>
                      {task.state === "downloading"
                        ? `${percent ?? 0}%`
                        : task.state === "installing"
                          ? "等待安装"
                          : task.message || "准备下载"}
                    </span>
                  </div>
                )}
              </div>
              <span
                className={`software-status ${
                  item.installed ? "installed" : "missing"
                }`}
              >
                {item.installed && <CheckCircle2 />}
                {item.installed ? "已安装" : "未安装"}
              </span>
              <div className="software-actions">
                {!item.installed && (
                  <button
                    className="button secondary compact-action"
                    onClick={() => void choose(item)}
                  >
                    <FolderSearch />
                    选择路径
                  </button>
                )}
                {item.installed ? (
                  <button
                    className="button primary"
                    disabled={launching === item.code}
                    onClick={() => void launch(item)}
                  >
                    <Play />
                    {launching === item.code ? "启动中" : "启动软件"}
                  </button>
                ) : (
                  <button
                    className="button primary"
                    disabled={Boolean(active)}
                    aria-label={
                      item.code === "5e" ? "打开 5E 官网" : undefined
                    }
                    onClick={() => void download(item)}
                  >
                    {item.code === "5e" ? <ExternalLink /> : <Download />}
                    {active
                      ? "处理中"
                      : item.code === "5e"
                        ? "打开官网"
                        : "下载安装"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className="platform-associations">
        <div className="section-heading">
          <h2>账号关联</h2>
        </div>
        {linkedCodes.length ? (
          linkedCodes.map((code) => (
            <div className="association-group" key={code}>
              <header>
                <h3>{labels[code]}</h3>
                <span>{grouped[code].length}</span>
              </header>
              <div>
                {grouped[code].map(
                  ({
                    account,
                    links: accountLinks,
                  }: {
                    account: Account;
                    links: PlatformLink[];
                  }) => (
                    <article key={account.id}>
                      <strong>
                        {account.personaName ||
                          account.alias ||
                          account.accountName ||
                          "未命名账号"}
                      </strong>
                      <small>…{account.steamId64.slice(-6)}</small>
                      <span>
                        {accountLinks
                          .map((link) => link.displayName || link.externalId)
                          .filter(Boolean)
                          .join(" · ") || "未填写平台昵称"}
                      </span>
                    </article>
                  ),
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="empty-line">暂无关联</p>
        )}
      </section>
    </section>
  );
}
