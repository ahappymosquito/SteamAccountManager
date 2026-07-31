/** Unified Steam and companion-client configuration with persistent drag ordering. */
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FolderSearch,
  GripVertical,
  Play,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { usePointerReorder } from "../lib/pointerReorder";
import type {
  AppError,
  DownloadProgress,
  PlatformApp,
  SoftwareStatus,
} from "../lib/types";

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败";

type PlatformCode = SoftwareStatus["code"];
export const DEFAULT_PLATFORM_ORDER: PlatformCode[] = [
  "steam",
  "5e",
  "perfectworld",
  "teamspeak3",
];

const catalog: Record<PlatformCode, SoftwareStatus> = {
  steam: {
    code: "steam",
    name: "Steam",
    installed: false,
    downloadMode: "browser_fallback",
    officialUrl: "https://store.steampowered.com/about/",
  },
  "5e": {
    code: "5e",
    name: "5E 对战平台",
    installed: false,
    downloadMode: "browser_fallback",
    officialUrl: "https://arena.5eplay.com/download/latest",
  },
  perfectworld: {
    code: "perfectworld",
    name: "完美世界竞技平台",
    installed: false,
    downloadMode: "managed",
    officialUrl: "https://pvp.wanmei.com/",
  },
  teamspeak3: {
    code: "teamspeak3",
    name: "TeamSpeak 3",
    installed: false,
    downloadMode: "managed",
    officialUrl: "https://www.teamspeak.com/en/downloads/",
  },
};

const officialIcons: Record<PlatformCode, string> = {
  steam: "/platforms/steam.ico",
  perfectworld: "/platforms/perfectworld.ico",
  "5e": "/platforms/5e.png",
  teamspeak3: "/platforms/teamspeak.png",
};

export function formatWindowsPath(value: string): string {
  const normalized = value.trim().replace(/^"(.*)"$/, "$1").replace(/\//g, "\\");
  return /^[a-z]:/.test(normalized)
    ? `${normalized[0].toUpperCase()}${normalized.slice(1)}`
    : normalized;
}

export function normalizePlatformOrder(value: unknown): PlatformCode[] {
  const requested = Array.isArray(value)
    ? value.filter(
        (code): code is PlatformCode =>
          typeof code === "string" &&
          DEFAULT_PLATFORM_ORDER.includes(code as PlatformCode),
      )
    : [];
  return [
    ...new Set(requested),
    ...DEFAULT_PLATFORM_ORDER.filter((code) => !requested.includes(code)),
  ];
}

export function PlatformsPage({
  notify,
}: {
  notify: (kind: "success" | "error", text: string) => void;
}) {
  const [software, setSoftware] = useState<SoftwareStatus[]>([]);
  const [order, setOrder] = useState<PlatformCode[]>(DEFAULT_PLATFORM_ORDER);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [detecting, setDetecting] = useState(false);
  const [launching, setLaunching] = useState<string>();

  const load = async () => {
    const [statuses, downloads, settings] = await Promise.all([
      api.softwareStatuses(),
      api.downloadProgress(),
      api.settings(),
    ]);
    const configuredSteam = formatWindowsPath(String(settings.steam_path ?? ""));
    const byCode = new Map<PlatformCode, SoftwareStatus>(
      statuses.map((item) => [
        item.code,
        {
          ...item,
          executablePath: item.executablePath
            ? formatWindowsPath(item.executablePath)
            : undefined,
        },
      ]),
    );
    byCode.set("steam", {
      ...catalog.steam,
      installed: Boolean(configuredSteam),
      executablePath: configuredSteam || undefined,
    });
    const nextOrder = normalizePlatformOrder(settings.platform_order);
    const nextSoftware = nextOrder.map((code) => byCode.get(code) ?? catalog[code]);
    setOrder(nextOrder);
    setSoftware(nextSoftware);
    setProgress(
      Object.fromEntries(
        downloads
          .filter((item) => item.state !== "completed")
          .map((item) => [item.code, item]),
      ),
    );
    return nextSoftware;
  };

  useEffect(() => {
    void load().catch((error) => notify("error", errorMessage(error)));
    let unlisten: (() => void) | undefined;
    void listen<DownloadProgress>("software-download-progress", (event) => {
      const item = event.payload;
      setProgress((current) => {
        const next = { ...current };
        if (item.state === "completed") delete next[item.code];
        else next[item.code] = item;
        return next;
      });
      if (item.state === "completed") void load();
    }).then((value) => {
      unlisten = value;
    });
    return () => unlisten?.();
  }, []);

  const detect = async () => {
    setDetecting(true);
    try {
      const [steamPath, found] = await Promise.all([
        api.discoverSteam(),
        api.discoverPlatformApps(),
      ]);
      if (steamPath) await api.setSteamPath(steamPath);
      await Promise.all(found.map((item) => api.savePlatformApp(item)));
      const statuses = await load();
      notify(
        "success",
        `检测到 ${statuses.filter((item) => item.installed).length} 个已安装软件`,
      );
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setDetecting(false);
    }
  };

  const choose = async (item: SoftwareStatus) => {
    const selected = await open(
      item.code === "steam"
        ? { directory: true, multiple: false, title: "选择 Steam 安装目录" }
        : {
            multiple: false,
            filters: [{ name: "Windows 程序", extensions: ["exe"] }],
            title: `选择${item.name}启动程序`,
          },
    );
    if (typeof selected !== "string") return;
    const normalizedPath = formatWindowsPath(selected);
    try {
      if (item.code === "steam") {
        await api.setSteamPath(normalizedPath);
      } else {
        const app: PlatformApp = {
          platformCode: item.code as PlatformApp["platformCode"],
          name: item.name,
          executablePath: normalizedPath,
          arguments: [],
          workingDirectory: normalizedPath.replace(/[\\][^\\]+$/, ""),
          prelaunchCheck: true,
        };
        await api.savePlatformApp(app);
      }
      await load();
      notify("success", `${item.name}路径已保存`);
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const download = async (item: SoftwareStatus) => {
    if (item.code === "5e" || item.code === "steam") {
      try {
        await api.openOfficialUrl(item.code);
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

  const reorder = async (source: PlatformCode, target: PlatformCode) => {
    if (source === target) return;
    const next = [...order];
    const sourceIndex = next.indexOf(source);
    const targetIndex = next.indexOf(target);
    next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, source);
    setOrder(next);
    setSoftware(next.map((code) => software.find((item) => item.code === code) ?? catalog[code]));
    try {
      await api.setSetting("platform_order", next);
    } catch (error) {
      notify("error", errorMessage(error));
      await load();
    }
  };
  const pointerSort = usePointerReorder((source, target) => {
    void reorder(source as PlatformCode, target as PlatformCode);
  });

  return (
    <section>
      <header className="page-heading">
        <div>
          <h1>平台</h1>
          <p>统一检测、配置和排列 Steam 与常用平台客户端。</p>
        </div>
        <button className="button secondary" disabled={detecting} onClick={() => void detect()}>
          <RefreshCw />
          {detecting ? "检测中" : "重新检测"}
        </button>
      </header>

      <section className="software-manager">
        <div className="section-heading">
          <h2>平台软件</h2>
          <p>拖动左侧把手可调整平台顺序。</p>
        </div>
        {software.map((item) => {
          const task = progress[item.code];
          const active =
            task && ["starting", "downloading", "installing"].includes(task.state);
          const percent = task?.total
            ? Math.min(100, Math.round((task.downloaded / task.total) * 100))
            : undefined;
          return (
            <article
              className={`software-row${
                pointerSort.draggingId === item.code ? " dragging" : ""
              }${
                pointerSort.targetId === item.code ? " drop-target" : ""
              }`}
              key={item.code}
              onPointerEnter={(event) => pointerSort.enter(item.code, event)}
            >
              <button
                type="button"
                className="software-drag-handle"
                aria-grabbed={pointerSort.draggingId === item.code}
                aria-label={`调整 ${item.name} 的顺序`}
                title="拖拽排序"
                onPointerDown={(event) => pointerSort.start(item.code, event)}
              >
                <GripVertical />
              </button>
              <div className={`software-icon ${item.code}`} aria-hidden="true">
                <img src={officialIcons[item.code]} alt="" />
              </div>
              <div className="software-info">
                <h3>{item.name}</h3>
                {item.executablePath && <p title={item.executablePath}>{item.executablePath}</p>}
                {task && task.state !== "completed" && (
                  <div className={`download-state ${task.state}`}>
                    {active && (
                      <div>
                        <i style={{ width: `${percent ?? 18}%` }} />
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
              <span className={`software-status ${item.installed ? "installed" : "missing"}`}>
                {item.installed && <CheckCircle2 />}
                {item.installed ? "已安装" : "未安装"}
              </span>
              <div className="software-actions">
                {!item.installed && (
                  <button className="button secondary compact-action" onClick={() => void choose(item)}>
                    <FolderSearch />
                    选择路径
                  </button>
                )}
                {item.installed ? (
                  <button
                    className="button primary"
                    aria-label="启动软件"
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
                      item.code === "5e"
                        ? "打开 5E 官网"
                        : item.code === "steam"
                          ? "打开 Steam 官网"
                          : undefined
                    }
                    onClick={() => void download(item)}
                  >
                    {item.code === "5e" || item.code === "steam" ? <ExternalLink /> : <Download />}
                    {active
                      ? "处理中"
                      : item.code === "5e" || item.code === "steam"
                        ? "打开官网"
                        : "下载安装"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </section>
  );
}
