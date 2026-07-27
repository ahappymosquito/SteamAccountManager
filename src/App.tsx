/** Main application shell coordinating navigation, account switching, and feature pages. */
import { useEffect, useMemo, useState } from "react";
import {
  FileClock,
  FileCode2,
  Heart,
  Info,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Star,
  UsersRound,
} from "lucide-react";

import { AccountAvatar } from "./components/AccountAvatar";
import { flushCfgDraft } from "./cfgWorkspace";
import { AccountDrawer } from "./components/AccountDrawer";
import { SteamLoginDialog } from "./components/SteamLoginDialog";
import { SwitchDialog } from "./components/SwitchDialog";
import { TagFilter } from "./components/TagFilter";
import { TitleBar } from "./components/TitleBar";
import { api } from "./lib/api";
import { APP_ICON_PATH } from "./lib/appMeta";
import { filterAccounts } from "./lib/filter";
import { applyTheme, resolveTheme, savedTheme, storedTheme } from "./lib/themes";
import type {
  Account,
  AppError,
  CurrentStatus,
  PlatformCode,
  ProfileInput,
  SteamLoginSession,
  SwitchLog,
  TagOption,
  Theme,
} from "./lib/types";
import { Cs2Page } from "./pages/Cs2Page";
import { PlatformsPage } from "./pages/PlatformsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useUi, type PlatformFilter } from "./store";

export { SettingsPage } from "./pages/SettingsPage";

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败，请稍后重试";
const formatTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "从未";
const platformLabels: Record<PlatformCode, string> = {
  perfectworld: "完美世界",
  "5e": "5E",
  faceit: "FACEIT",
  other: "其他",
};

export default function App() {
  const ui = useUi();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [status, setStatus] = useState<CurrentStatus>();
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<Account>();
  const [switching, setSwitching] = useState<Account>();
  const [loginSession, setLoginSession] = useState<SteamLoginSession>();
  const [theme, setTheme] = useState<Theme>(savedTheme());

  const notify = (kind: "success" | "error", text: string) => {
    ui.notify({ kind, text });
    window.setTimeout(() => ui.notify(null), 4500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [items, current, tags] = await Promise.all([
        api.accounts(),
        api.status(),
        api.tags(),
      ]);
      setAccounts(items);
      setStatus(current);
      setTagOptions(tags);
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setLoading(false);
    }
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
    const initializeSteam = async () => {
      try {
        const result = await api.initializeSteam();
        if (!result.steamPath) {
          notify("error", "未自动检测到 Steam，请在设置中选择安装目录");
        }
      } catch (error) {
        notify("error", errorMessage(error));
      } finally {
        await load();
      }
    };
    void restoreTheme();
    void initializeSteam();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(
    () =>
      filterAccounts(
        accounts,
        ui.query,
        ui.favoriteOnly,
        ui.platform,
        ui.selectedTags,
      ),
    [accounts, ui.query, ui.favoriteOnly, ui.platform, ui.selectedTags],
  );

  const updateTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    void api.setSetting("theme", nextTheme).catch(() => {
      notify("error", "主题已预览，但未能保存到应用设置");
    });
  };
  const scan = async () => {
    try {
      const count = await api.scan();
      await load();
      notify("success", `已同步 ${count} 个本机 Steam 账号`);
    } catch (error) {
      notify("error", errorMessage(error));
    }
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
  const performSwitch = async () => {
    if (!switching) return;
    try {
      await flushCfgDraft();
      await api.switchAccount(switching.steamId64);
      await load();
      notify("success", "启动参数与 CFG 已验证，Steam 账号切换完成");
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
          <div className="safety-note">
            <ShieldCheck />
            <span>不保存密码、Cookie、Token 或 Steam Guard 密钥</span>
          </div>
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
              status={status}
              ui={ui}
              onScan={scan}
              onAdd={beginLogin}
              onDetails={setDetails}
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
          {ui.page === "cs2" && (
            <Cs2Page notify={notify} />
          )}
          {ui.page === "platforms" && (
            <PlatformsPage accounts={accounts} notify={notify} />
          )}
          {ui.page === "logs" && <LogsPage notify={notify} />}
          {ui.page === "settings" && (
            <SettingsPage notify={notify} onConfigured={load} />
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
          onOpenChange={(value) => !value && setDetails(undefined)}
          onSave={saveProfile}
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

function Status({ status }: { status?: CurrentStatus }) {
  const labels = {
    locally_confirmed: "本地确认",
    inferred: "当前推测",
    steam_not_running: "Steam 未运行",
    unknown: "状态未知",
  };
  return (
    <div className={`status ${status?.kind ?? "unknown"}`}>
      <span />
      {status ? labels[status.kind] : "正在检查"}
      {status?.accountName && <strong>{status.accountName}</strong>}
    </div>
  );
}

function AccountsPage({
  accounts,
  tagOptions,
  loading,
  status,
  ui,
  onScan,
  onAdd,
  onDetails,
  onSwitch,
  onFavorite,
}: {
  accounts: Account[];
  tagOptions: TagOption[];
  loading: boolean;
  status?: CurrentStatus;
  ui: ReturnType<typeof useUi>;
  onScan: () => void;
  onAdd: () => void;
  onDetails: (account: Account) => void;
  onSwitch: (account: Account) => void;
  onFavorite: (account: Account) => void;
}) {
  return (
    <section>
      <header className="page-heading account-heading">
        <div>
          <h1>Steam 账号</h1>
          <p>{accounts.length} 个符合当前条件的本机已记住账号</p>
        </div>
        <Status status={status} />
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
        <button className="button primary" onClick={onScan}>
          <RefreshCw />
          重新扫描
        </button>
      </section>
      {loading ? (
        <div className="skeleton-list" aria-label="正在加载">
          <i />
          <i />
          <i />
        </div>
      ) : accounts.length === 0 ? (
        <div className="empty">
          <UsersRound />
          <h2>没有符合条件的账号</h2>
          <p>
            在 Steam 官方客户端登录并勾选“记住我”，或调整当前筛选条件。
          </p>
          <button className="button primary" onClick={onAdd}>
            添加 Steam 账号
          </button>
        </div>
      ) : (
        <section className="account-list">
          {accounts.map((account) => (
            <article
              className="account-row clickable"
              key={account.id}
              onClick={() => onDetails(account)}
            >
              <AccountAvatar account={account} />
              <div className="account-main">
                <div className="account-title">
                  <h2>
                    {account.personaName ||
                      account.alias ||
                      account.accountName ||
                      "未命名账号"}
                  </h2>
                  {account.favorite && <Star className="favorite" />}
                </div>
                <div className="metadata-row">
                  <div className="platform-badges">
                    {(account.platformCodes ?? []).map((code) => (
                      <span className="platform-badge" key={code}>
                        {platformLabels[code]}
                      </span>
                    ))}
                    {!(account.platformCodes ?? []).length && (
                      <span className="platform-badge muted">未关联平台</span>
                    )}
                  </div>
                  <div className="tags">
                    {account.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="account-detail">
                <span className="remark" title={account.remark}>
                  {account.remark || "暂无备注"}
                </span>
                <small>最近切换 {formatTime(account.lastSwitchedAt)}</small>
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
