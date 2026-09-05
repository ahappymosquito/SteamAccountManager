/** Main application shell coordinating navigation, account switching, and feature pages. */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookUser,
  FileClock,
  FileCode2,
  GripVertical,
  Heart,
  Info,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  UsersRound,
} from "lucide-react";

import { getVersion } from "@tauri-apps/api/app";
import { AccountAvatar } from "./components/AccountAvatar";
import {
  AccountPlatformBadges,
  type QuickPlatformCode,
} from "./components/AccountPlatformBadges";
import { flushCfgDraft } from "./cfgWorkspace";
import { AccountDrawer } from "./components/AccountDrawer";
import { PlatformAccountDialog } from "./components/PlatformAccountDialog";
import { CurrentSteamStatus } from "./components/CurrentSteamStatus";
import { SteamLoginDialog } from "./components/SteamLoginDialog";
import { SwitchDialog } from "./components/SwitchDialog";
import { TagFilter } from "./components/TagFilter";
import { TitleBar } from "./components/TitleBar";
import { api } from "./lib/api";
import { APP_ICON_PATH } from "./lib/appMeta";
import {
  applyAccountOrder,
  filterAccounts,
  normalizeAccountOrder,
  sortAccounts,
} from "./lib/filter";
import { usePointerReorder } from "./lib/pointerReorder";
import { applyTheme, resolveTheme, savedTheme, storedTheme } from "./lib/themes";
import { switchResultNotice } from "./lib/switchResult";
import type {
  Account,
  AppError,
  CurrentStatus,
  ProfileInput,
  SteamLoginSession,
  SwitchLog,
  SwitchProgress,
  TagOption,
  Theme,
  UpdateInfo,
  UpdateProgress,
} from "./lib/types";
import { Cs2Page } from "./pages/Cs2Page";
import { PlatformsPage } from "./pages/PlatformsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TravelPage } from "./pages/TravelPage";
import { useUi, type NoticeKind, type PlatformFilter } from "./store";

export { SettingsPage } from "./pages/SettingsPage";

export const ACCOUNT_REFRESH_INTERVAL_MS = 10_000;
export const APP_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type AccountScanKind = "startup" | "manual" | "silent";
type AccountScanTask = { promise: Promise<void>; visible: boolean };

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败，请稍后重试";
const formatTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "从未";
export default function App() {
  const ui = useUi();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [status, setStatus] = useState<CurrentStatus>();
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [details, setDetails] = useState<Account>();
  const [platformEditor, setPlatformEditor] = useState<{
    account: Account;
    platform: QuickPlatformCode;
  }>();
  const [accountOrder, setAccountOrder] = useState<string[]>([]);
  const [steamOnlySwitch, setSteamOnlySwitch] = useState(true);
  const [switching, setSwitching] = useState<Account>();
  const [loginSession, setLoginSession] = useState<SteamLoginSession>();
  const [theme, setTheme] = useState<Theme>(savedTheme());
  const [appUpdate, setAppUpdate] = useState<UpdateInfo>();
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress>();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const scanTask = useRef<AccountScanTask | undefined>(undefined);

  const notify = (kind: NoticeKind, text: string) => {
    ui.notify({ kind, text });
    window.setTimeout(() => ui.notify(null), 4500);
  };

  const load = async (showLoading = true, reportErrors = true) => {
    if (showLoading) setLoading(true);
    try {
      const [items, current, tags, settings] = await Promise.all([
        api.accounts(),
        api.status(),
        api.tags(),
        api.settings(),
      ]);
      setAccounts(items);
      setAccountOrder(normalizeAccountOrder(items, settings.account_order));
      setSteamOnlySwitch(settings.steam_only_switch !== false);
      setStatus(current);
      setTagOptions(tags);
    } catch (error) {
      if (reportErrors) notify("error", errorMessage(error));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const startAccountScan = (kind: AccountScanKind) => {
    const activeTask = scanTask.current;
    if (activeTask) {
      if (kind === "manual" && !activeTask.visible) {
        activeTask.visible = true;
        setScanning(true);
      }
      return { started: false, promise: activeTask.promise };
    }

    const task: AccountScanTask = {
      visible: kind === "manual",
      promise: Promise.resolve(),
    };
    if (task.visible) setScanning(true);
    task.promise = (async () => {
      try {
        let accountCount = 0;
        if (kind === "startup") {
          const result = await api.initializeSteam();
          accountCount = result.accountCount;
          if (!result.steamPath) {
            notify("error", "未自动检测到 Steam，请在设置中选择安装目录");
            return;
          }
        } else {
          accountCount = await api.scan();
        }

        await load(false, kind === "manual");
        if (kind !== "silent") {
          void api
            .refreshSteamProfileMedia(kind === "manual")
            .then(() => load(false, false))
            .catch((error) => {
              if (kind === "manual") notify("error", errorMessage(error));
            });
        }
        if (kind === "manual") {
          notify("success", `已同步 ${accountCount} 个本机 Steam 账号`);
        }
      } catch (error) {
        if (kind !== "silent") notify("error", errorMessage(error));
      } finally {
        if (scanTask.current === task) scanTask.current = undefined;
        if (task.visible) setScanning(false);
      }
    })();
    scanTask.current = task;
    return { started: true, promise: task.promise };
  };

  useEffect(() => {
    let active = true;
    const restoreTheme = async () => {
      try {
        const settings = await api.settings();
        if (!active) return;
        const nextTheme = resolveTheme(storedTheme(), settings.theme);
        setTheme(nextTheme);
        applyTheme(nextTheme);
      } catch (error) {
        notify("error", errorMessage(error));
      }
    };
    void restoreTheme();
    void getVersion().then(setAppVersion).catch(() => setAppVersion(""));
    void load(false, false).finally(() => {
      if (active) startAccountScan("startup");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (ui.page !== "accounts") return;
    const timer = window.setInterval(() => {
      void startAccountScan("silent").promise;
    }, ACCOUNT_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [ui.page]);

  const checkForUpdate = async (manual = false) => {
    setCheckingUpdate(true);
    if (manual) {
      setUpdateProgress({ state: "checking", downloaded: 0 });
    }
    try {
      const update = await api.checkAppUpdate();
      setAppUpdate(update ?? undefined);
      setUpdateProgress(undefined);
      if (manual && !update) notify("success", "当前已是最新版本");
      return update;
    } catch (error) {
      setUpdateProgress(undefined);
      if (manual) notify("error", errorMessage(error));
      return null;
    } finally {
      setCheckingUpdate(false);
    }
  };

  const installUpdate = async () => {
    if (!appUpdate) return;
    try {
      await api.installAppUpdate(setUpdateProgress);
    } catch (error) {
      setUpdateProgress({
        state: "error",
        downloaded: updateProgress?.downloaded ?? 0,
        message: errorMessage(error),
      });
      notify("error", errorMessage(error));
    }
  };

  useEffect(() => {
    void checkForUpdate(false);
    const timer = window.setInterval(() => {
      void checkForUpdate(false);
    }, APP_UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = useMemo(
    () =>
      sortAccounts(
        filterAccounts(
          applyAccountOrder(accounts, accountOrder),
          ui.query,
          ui.favoriteOnly,
          ui.platform,
          ui.selectedTags,
        ),
        ui.accountSort,
      ),
    [accounts, accountOrder, ui.query, ui.favoriteOnly, ui.platform, ui.selectedTags, ui.accountSort],
  );

  const reorderAccounts = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const previous = accountOrder;
    const normalized = normalizeAccountOrder(accounts, accountOrder);
    const sourceIndex = normalized.indexOf(sourceId);
    const targetIndex = normalized.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...normalized];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    setAccountOrder(next);
    try {
      await api.setSetting("account_order", next);
    } catch (error) {
      setAccountOrder(previous);
      notify("error", `账号顺序保存失败：${errorMessage(error)}`);
    }
  };

  const updateTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    void api.setSetting("theme", nextTheme).catch(() => {
      notify("error", "主题已预览，但未能保存到应用设置");
    });
  };
  const toggleSteamOnlySwitch = async () => {
    const previous = steamOnlySwitch;
    const next = !previous;
    setSteamOnlySwitch(next);
    try {
      await api.setSetting("steam_only_switch", next);
    } catch (error) {
      setSteamOnlySwitch(previous);
      notify("error", `切换模式保存失败：${errorMessage(error)}`);
    }
  };
  const scan = () => {
    void startAccountScan("manual").promise;
  };
  const saveProfile = async (input: ProfileInput) => {
    try {
      await api.saveProfile(input);
      await load();
      notify("success", "账号资料已保存");
    } catch (error) {
      notify("error", errorMessage(error));
      throw error;
    }
  };
  const performSwitch = async (onProgress: (progress: SwitchProgress) => void) => {
    if (!switching) return;
    try {
      await flushCfgDraft();
      const result = await api.switchAccount(switching.steamId64, onProgress);
      await load();
      const notice = switchResultNotice(result);
      notify(notice.kind, notice.text);
    } catch (error) {
      notify("error", errorMessage(error));
      throw error;
    }
  };
  const beginLogin = async () => {
    if (
      !confirm(
        "将正常关闭并重新启动 Steam。随后请在 Steam 官方窗口登录并勾选“记住我”。继续吗？",
      )
    )
      return;
    try {
      setLoginSession(await api.beginSteamLogin());
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };
  const cancelLogin = async () => {
    const session = loginSession;
    setLoginSession(undefined);
    if (session) await api.cancelSteamLogin(session.id).catch(() => {});
  };

  useEffect(() => {
    if (!loginSession) return;
    let checking = false;
    const timer = window.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await api.steamLoginStatus(loginSession.id);
        if (result.state === "completed") {
          window.clearInterval(timer);
          setLoginSession(undefined);
          await load();
          notify("success", result.message || "账号列表已刷新");
        } else if (result.state === "timed_out" || result.state === "failed") {
          window.clearInterval(timer);
          setLoginSession(undefined);
          notify("error", result.message || "未检测到 Steam 登录");
        }
      } catch (error) {
        window.clearInterval(timer);
        setLoginSession(undefined);
        notify("error", errorMessage(error));
      } finally {
        checking = false;
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loginSession?.id]);

  return (
    <div className="app-frame">
      <TitleBar theme={theme} onThemeChange={updateTheme} />
      <div className="app-body">
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-logo" src={APP_ICON_PATH} alt="" />
            <div>
              <strong>Steam Account</strong>
              <span>Manager · 非官方工具</span>
            </div>
          </div>
          <nav aria-label="主导航">
            <Nav
              active={ui.page === "accounts"}
              icon={<UsersRound />}
              text="账号"
              onClick={() => ui.setPage("accounts")}
            />
            <Nav
              active={ui.page === "travel"}
              icon={<BookUser />}
              text="外出资料"
              onClick={() => ui.setPage("travel")}
            />
            <Nav
              active={ui.page === "cs2"}
              icon={<FileCode2 />}
              text="CS2 配置"
              onClick={() => ui.setPage("cs2")}
            />
            <Nav
              active={ui.page === "platforms"}
              icon={<LayoutGrid />}
              text="平台"
              onClick={() => ui.setPage("platforms")}
            />
            <Nav
              active={ui.page === "logs"}
              icon={<FileClock />}
              text="切换日志"
              onClick={() => ui.setPage("logs")}
            />
            <Nav
              active={ui.page === "settings"}
              icon={<Settings />}
              text="设置"
              onClick={() => ui.setPage("settings")}
            />
          </nav>
          <SidebarUpdate
            version={appVersion}
            update={appUpdate}
            progress={updateProgress}
            checking={checkingUpdate}
            onCheck={() => void checkForUpdate(true)}
            onInstall={() => void installUpdate()}
          />
        </aside>
        <main className="content">
          {ui.notice && (
            <div role="status" className={`notice ${ui.notice.kind}`}>
              {ui.notice.text}
            </div>
          )}
          {ui.page === "accounts" && (
            <AccountsPage
              accounts={filtered}
              tagOptions={tagOptions}
              loading={loading}
              scanning={scanning}
              status={status}
              ui={ui}
              onScan={scan}
              onAdd={beginLogin}
              onDetails={(account) => {
                setDetails(account);
              }}
              onPlatform={(account, platform) => {
                setPlatformEditor({ account, platform });
              }}
              onReorder={(sourceId, targetId) =>
                void reorderAccounts(sourceId, targetId)
              }
              steamOnlySwitch={steamOnlySwitch}
              onSteamOnlySwitch={() => void toggleSteamOnlySwitch()}
              onSwitch={setSwitching}
              onFavorite={(account) =>
                saveProfile({
                  accountId: account.id,
                  alias: account.alias,
                  remark: account.remark,
                  favorite: !account.favorite,
                  tags: account.tags,
                })
              }
            />
          )}
          {ui.page === "travel" && <TravelPage notify={notify} />}
          {ui.page === "cs2" && (
            <Cs2Page notify={notify} />
          )}
          {ui.page === "platforms" && (
            <PlatformsPage notify={notify} />
          )}
          {ui.page === "logs" && <LogsPage notify={notify} />}
          {ui.page === "settings" && (
            <SettingsPage
              notify={notify}
              onConfigured={load}
              update={appUpdate}
              updateProgress={updateProgress}
              checkingUpdate={checkingUpdate}
              onCheckUpdate={() => void checkForUpdate(true)}
              onInstallUpdate={() => void installUpdate()}
            />
          )}
        </main>
      </div>
      {details && (
        <AccountDrawer
          account={
            accounts.find((account) => account.id === details.id) ?? details
          }
          tagOptions={tagOptions}
          open
          onOpenChange={(value) => {
            if (!value) setDetails(undefined);
          }}
          onSave={saveProfile}
          notify={notify}
          onChanged={() => void load()}
        />
      )}
      {platformEditor && (
        <PlatformAccountDialog
          account={
            accounts.find(
              (account) => account.id === platformEditor.account.id,
            ) ?? platformEditor.account
          }
          platform={platformEditor.platform}
          open
          onOpenChange={(value) => !value && setPlatformEditor(undefined)}
          notify={notify}
          onChanged={() => void load()}
        />
      )}
      <SteamLoginDialog
        session={loginSession}
        open={Boolean(loginSession)}
        onCancel={() => void cancelLogin()}
      />
      {switching && (
        <SwitchDialog
          account={switching}
          status={status}
          steamOnlySwitch={steamOnlySwitch}
          open
          onOpenChange={(value) => !value && setSwitching(undefined)}
          onConfirm={performSwitch}
        />
      )}
    </div>
  );
}

function Nav({
  active,
  icon,
  text,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  text: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{text}</span>
    </button>
  );
}

function SidebarUpdate({
  version,
  update,
  progress,
  checking,
  onCheck,
  onInstall,
}: {
  version: string;
  update?: UpdateInfo;
  progress?: UpdateProgress;
  checking: boolean;
  onCheck: () => void;
  onInstall: () => void;
}) {
  const busy =
    progress?.state === "downloading" || progress?.state === "installing";
  const percent =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : undefined;
  const status =
    progress?.state === "downloading"
      ? percent === undefined
        ? "正在下载"
        : `下载 ${percent}%`
      : progress?.state === "installing"
        ? "正在安装"
        : progress?.state === "completed"
          ? "即将重启"
          : progress?.state === "error"
            ? progress.message || "更新失败"
            : update
              ? `可更新至 v${update.version}`
              : "已是最新";

  return (
    <footer className="sidebar-update">
      <div>
        <strong>{version ? `v${version}` : "版本"}</strong>
        <span>{status}</span>
      </div>
      {busy && (
        <div
          className="sidebar-update-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? 0}
        >
          <i style={{ width: `${percent ?? 15}%` }} />
        </div>
      )}
      {update ? (
        <button
          className="button primary"
          disabled={busy}
          onClick={onInstall}
        >
          {busy && <RefreshCw className="spin-icon" aria-hidden="true" />}
          {busy ? status : "更新"}
        </button>
      ) : (
        <button
          className="button secondary"
          disabled={checking || busy}
          onClick={onCheck}
        >
          <RefreshCw className={checking ? "spin-icon" : undefined} />
          {checking ? "检查中" : "检查更新"}
        </button>
      )}
    </footer>
  );
}

export function AccountsPage({
  accounts,
  tagOptions,
  loading,
  scanning,
  status,
  ui,
  onScan,
  onAdd,
  onDetails,
  onPlatform,
  onReorder,
  steamOnlySwitch,
  onSteamOnlySwitch,
  onSwitch,
  onFavorite,
}: {
  accounts: Account[];
  tagOptions: TagOption[];
  loading: boolean;
  scanning: boolean;
  status?: CurrentStatus;
  ui: ReturnType<typeof useUi>;
  onScan: () => void;
  onAdd: () => void;
  onDetails: (account: Account) => void;
  onPlatform: (account: Account, platform: QuickPlatformCode) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  steamOnlySwitch: boolean;
  onSteamOnlySwitch: () => void;
  onSwitch: (account: Account) => void;
  onFavorite: (account: Account) => void;
}) {
  const reorderEnabled =
    !ui.query.trim() &&
    !ui.favoriteOnly &&
    !ui.platform &&
    ui.selectedTags.length === 0 &&
    ui.accountSort === "custom";

  const moveByKeyboard = (account: Account, offset: -1 | 1) => {
    const index = accounts.findIndex((item) => item.id === account.id);
    const target = accounts[index + offset];
    if (target) onReorder(account.steamId64, target.steamId64);
  };
  const pointerSort = usePointerReorder(onReorder);

  return (
    <section>
      <header className="page-heading account-heading">
        <div>
          <h1>Steam 账号</h1>
          <p>{accounts.length} 个符合当前条件的本机已记住账号</p>
        </div>
        <CurrentSteamStatus status={status} />
      </header>
      <section className="toolbar">
        <label className="search">
          <Search />
          <input
            aria-label="搜索账号"
            placeholder="搜索昵称、别名、备注或标签"
            value={ui.query}
            onChange={(event) => ui.setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="按平台筛选"
          value={ui.platform}
          onChange={(event) =>
            ui.setPlatform(event.target.value as PlatformFilter)
          }
        >
          <option value="">所有平台</option>
          <option value="perfectworld">完美世界</option>
          <option value="5e">5E</option>
          <option value="faceit">FACEIT</option>
          <option value="other">其他</option>
          <option value="unlinked">未关联平台</option>
        </select>
        {ui.platform === "5e" && (
          <select
            className="account-sort"
            aria-label="5E 账号排序"
            value={ui.accountSort}
            onChange={(event) =>
              ui.setAccountSort(
                event.target.value as "score_desc" | "score_asc" | "custom",
              )
            }
          >
            <option value="score_asc">分数从低到高</option>
            <option value="score_desc">分数从高到低</option>
            <option value="custom">自定义顺序</option>
          </select>
        )}
        <TagFilter
          options={tagOptions}
          selected={ui.selectedTags}
          onChange={ui.setSelectedTags}
        />
        <button
          className={`toggle ${ui.favoriteOnly ? "on" : ""}`}
          onClick={() => ui.setFavoriteOnly(!ui.favoriteOnly)}
        >
          <Heart />
          收藏
        </button>
        <span className="spacer" />
        <button className="button secondary" onClick={onAdd}>
          <Plus />
          添加 Steam 账号
        </button>
        <button
          className="button primary"
          onClick={onScan}
          disabled={scanning}
          aria-busy={scanning}
        >
          <RefreshCw className={scanning ? "spin-icon" : undefined} />
          {scanning ? "正在扫描" : "重新扫描"}
        </button>
      </section>
      <button
        type="button"
        className={`list-switch${steamOnlySwitch ? " on" : ""}`}
        aria-pressed={steamOnlySwitch}
        title={
          steamOnlySwitch
            ? "只切换 Steam，不启动 5E 或完美。再点一次关闭。"
            : "切号后启动已关联的 5E 和完美。再点一次打开只切 Steam。"
        }
        onClick={onSteamOnlySwitch}
      >
        <span>只切 Steam</span>
        <span className="switch-track" aria-hidden="true">
          <i className="switch-thumb" />
        </span>
      </button>
      {loading ? (
        <div className="skeleton-list" aria-label="正在加载">
          <i />
          <i />
          <i />
        </div>
      ) : accounts.length === 0 && scanning ? (
        <div className="empty scan-empty" role="status" aria-live="polite">
          <RefreshCw className="spinner-icon" />
          <h2>正在扫描本机 Steam 账号</h2>
          <p>发现账号后会立即显示，头像和头像框将在后台继续同步。</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="empty">
          <UsersRound />
          <h2>没有符合条件的账号</h2>
          <p>
            在 Steam 官方客户端登录并勾选“记住我”，或到「外出资料」查看未登录账号的登录名、平台号和 CFG。
          </p>
          <div className="button-stack">
            <button className="button primary" onClick={onAdd}>
              添加 Steam 账号
            </button>
            <button className="button secondary" onClick={() => ui.setPage("travel")}>
              打开外出资料
            </button>
          </div>
        </div>
      ) : (
        <section className="account-list">
          {accounts.map((account) => (
            <article
              className={`account-row clickable${
                pointerSort.draggingId === account.steamId64 ? " dragging" : ""
              }${
                pointerSort.targetId === account.steamId64 ? " drop-target" : ""
              }`}
              key={account.id}
              onPointerEnter={(event) => {
                if (reorderEnabled) {
                  pointerSort.enter(account.steamId64, event);
                }
              }}
              onClick={() => {
                if (!pointerSort.consumeClick()) onDetails(account);
              }}
            >
              <button
                type="button"
                className="account-drag-handle"
                disabled={!reorderEnabled}
                aria-grabbed={
                  pointerSort.draggingId === account.steamId64
                }
                aria-label={`调整 ${account.personaName || "未命名 Steam 账号"} 的顺序`}
                title={
                  reorderEnabled
                    ? "拖拽排序；也可按 Alt + ↑/↓"
                    : "清除筛选后可调整顺序"
                }
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => {
                  if (reorderEnabled) {
                    pointerSort.start(account.steamId64, event);
                  }
                }}
                onKeyDown={(event) => {
                  if (!reorderEnabled || !event.altKey) return;
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveByKeyboard(account, -1);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveByKeyboard(account, 1);
                  }
                }}
              >
                <GripVertical />
              </button>
              <div className="account-identity">
                <AccountAvatar account={account} />
                <div className="account-main">
                  <div className="account-title">
                    <h2>
                      {account.personaName ||
                        "未命名 Steam 账号"}
                    </h2>
                    {account.favorite && <Star className="favorite" />}
                  </div>
                </div>
              </div>
              <div className="account-platform-status">
                <AccountPlatformBadges
                  account={account}
                  showFiveEScore={ui.platform === "5e"}
                  onSelect={(platform) => onPlatform(account, platform)}
                />
              </div>
              <div
                className="row-actions"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  className="icon-button"
                  title="收藏"
                  aria-label="切换收藏状态"
                  onClick={() => void onFavorite(account)}
                >
                  <Star />
                </button>
                <button
                  className="button secondary stable-action"
                  onClick={() => onDetails(account)}
                >
                  <Info />
                  <span className="action-label">查看详情</span>
                </button>
                <button
                  className="button primary stable-action"
                  onClick={() => onSwitch(account)}
                >
                  <span className="action-label">切换账号</span>
                  <span className="compact-label">切换</span>
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}

function LogsPage({
  notify,
}: {
  notify: (kind: "success" | "error", text: string) => void;
}) {
  const [logs, setLogs] = useState<SwitchLog[]>([]);
  const load = () =>
    api
      .logs()
      .then(setLogs)
      .catch((error) => notify("error", errorMessage(error)));
  useEffect(() => {
    void load();
  }, []);
  const clear = async () => {
    if (!confirm("确认清空全部切换日志？此操作不能撤销。")) return;
    await api.clearLogs();
    await load();
    notify("success", "切换日志已清空");
  };
  return (
    <section>
      <header className="page-heading">
        <div>
          <h1>切换日志</h1>
          <p>记录账号切换、启动参数与 CFG 同步的最终结果。</p>
        </div>
      </header>
      <section className="page-panel">
        <div className="panel-heading">
          <div>
            <h2>最近切换记录</h2>
            <p>登录名默认脱敏，最多显示最近 500 条。</p>
          </div>
          <button className="button danger" onClick={() => void clear()}>
            清空日志
          </button>
        </div>
        {logs.length === 0 ? (
          <div className="empty compact">
            <FileClock />
            <h2>还没有切换记录</h2>
            <p>完成一次账号切换后，结果会显示在这里。</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>目标账号</th>
                <th>结果</th>
                <th>错误信息</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatTime(log.startedAt)}</td>
                  <td>{log.accountName || "未知"}</td>
                  <td>
                    <span
                      className={`badge ${
                        log.result === "success" ? "available" : "failed"
                      }`}
                    >
                      {log.result === "success" ? "成功" : "失败"}
                    </span>
                  </td>
                  <td>{log.errorMessage || "无"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
