/** 外出资料卡：U 盘资料包，以及按 TeamSpeak Unique ID 登录云存档。 */
import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  BookUser,
  CloudDownload,
  CloudUpload,
  Copy,
  Download,
  Eye,
  EyeOff,
  Replace,
  Upload,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  AppError,
  CfgDeployReport,
  TravelIdentity,
  TravelPlatformCred,
  Ts3Identity,
} from "../lib/types";

const errorMessage = (error: unknown) =>
  (error as AppError)?.message || "操作失败";

const identityTitle = (item: TravelIdentity) =>
  item.alias || item.personaName || item.accountName || "未命名身份";

export function TravelPage({
  notify,
}: {
  notify: (kind: "success" | "error", text: string) => void;
}) {
  const [items, setItems] = useState<TravelIdentity[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [ts3Id, setTs3Id] = useState("");
  const [ts3Identities, setTs3Identities] = useState<Ts3Identity[]>([]);
  const [deploy, setDeploy] = useState<CfgDeployReport | null>(null);

  const refresh = async () => {
    setItems(await api.travelIdentities());
  };

  useEffect(() => {
    void (async () => {
      try {
        const [list, remembered] = await Promise.all([
          api.ts3Identities(),
          api.rememberedTs3Id(),
        ]);
        setTs3Identities(list);
        const detected = list.find((item) => item.uniqueId)?.uniqueId;
        setTs3Id(detected || remembered || "");
      } catch {
        try {
          const remembered = await api.rememberedTs3Id();
          if (remembered) setTs3Id(remembered);
        } catch {
          /* TeamSpeak 不是使用云存档的前提 */
        }
      }
      try {
        await refresh();
      } catch (error) {
        notify("error", errorMessage(error));
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [
        item.alias,
        item.personaName,
        item.accountName,
        item.fiveE?.loginAccount,
        item.fiveE?.displayName,
        item.perfectWorld?.loginAccount,
        item.perfectWorld?.displayName,
        item.cfg?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  const copyValue = async (label: string, value?: string) => {
    if (!value) {
      notify("error", `没有可复制的${label}`);
      return;
    }
    try {
      await writeText(value);
      notify("success", `${label}已复制`);
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  const runVault = async (action: () => Promise<void>) => {
    const id = ts3Id.trim();
    if (!id) {
      notify("error", "请填写 TeamSpeak Unique ID");
      return;
    }
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const uploadVault = () =>
    void runVault(async () => {
      await api.uploadTravelVault(ts3Id);
      notify("success", "已按当前 TeamSpeak ID 上传外出资料");
    });

  const downloadVault = () =>
    void runVault(async () => {
      const result = await api.downloadTravelVault(ts3Id);
      await refresh();
      notify(
        "success",
        `已拉取 ${result.identityCount} 个身份。需要覆盖本机 CFG 时再点「一键替代」`,
      );
    });

  const replaceVault = () =>
    void runVault(async () => {
      const result = await api.replaceTravelVault(ts3Id);
      await refresh();
      setDeploy(result.deploy);
      notify("success", result.deploy.message);
    });

  const deployLocal = async () => {
    setBusy(true);
    try {
      const report = await api.deployTravelCfgs();
      setDeploy(report);
      notify("success", report.message);
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const exportPack = async () => {
    const path = await save({
      defaultPath: "外出资料.json",
      filters: [{ name: "外出资料包", extensions: ["json"] }],
      title: "导出外出资料包",
    });
    if (!path) return;
    setBusy(true);
    try {
      const result = await api.exportTravelPack(path);
      notify(
        "success",
        `已导出 ${result.identityCount} 个身份，请与便携版一起带走`,
      );
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const importPack = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "外出资料包", extensions: ["json"] }],
      title: "导入外出资料包",
    });
    if (typeof path !== "string") return;
    setBusy(true);
    try {
      const result = await api.importTravelPack(path);
      await refresh();
      notify(
        "success",
        `已导入 ${result.identityCount} 个身份，未登录 Steam 的记录只出现在本页`,
      );
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const exportCfg = async (item: TravelIdentity) => {
    if (!item.cfg) return;
    const path = await save({
      defaultPath: item.cfg.fileName,
      filters: [{ name: "CS2 CFG", extensions: ["cfg"] }],
      title: "导出 CFG",
    });
    if (!path) return;
    try {
      const exported = await api.exportCfgText(path, item.cfg.content);
      notify("success", `已导出到 ${exported}`);
    } catch (error) {
      notify("error", errorMessage(error));
    }
  };

  return (
    <section className="travel-page">
      <header className="page-heading">
        <div>
          <h1>外出资料</h1>
          <p>
            用自己的 TeamSpeak Unique ID 登录云存档，或继续用 U 盘资料包。不能替你登 Steam，也没有 Steam 密码。
          </p>
        </div>
      </header>
      <section className="travel-vault">
        <h2>TeamSpeak 存档</h2>
        <p>
          在 TeamSpeak「身份」里复制 Unique ID。相同 ID 拉取同一份资料。知道这个 ID 就能读取 5E/完美明文，不要填别人的。
        </p>
        {ts3Identities.length > 0 ? (
          <div className="travel-identities">
            {ts3Identities.map((identity) => (
              <button
                key={identity.uuid}
                type="button"
                className="button secondary"
                disabled={busy || !identity.uniqueId}
                onClick={() => identity.uniqueId && setTs3Id(identity.uniqueId)}
              >
                {identity.nickname || "TeamSpeak 身份"}
                {identity.uniqueId ? "" : "（请手动粘贴 Unique ID）"}
              </button>
            ))}
          </div>
        ) : (
          <p>本机没有读到 TeamSpeak 身份时，把 Unique ID 粘贴到下面即可。</p>
        )}
        <div className="travel-vault-row">
          <label className="search">
            <input
              aria-label="TeamSpeak Unique ID"
              value={ts3Id}
              onChange={(event) => setTs3Id(event.target.value)}
              placeholder="TeamSpeak Unique ID"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="button secondary" disabled={busy} onClick={uploadVault}>
            <CloudUpload />
            <span>上传当前资料</span>
          </button>
          <button className="button secondary" disabled={busy} onClick={downloadVault}>
            <CloudDownload />
            <span>拉取资料</span>
          </button>
          <button className="button primary" disabled={busy} onClick={replaceVault}>
            <Replace />
            <span>一键替代</span>
          </button>
          <button className="button secondary" disabled={busy || items.length === 0} onClick={() => void deployLocal()}>
            <Upload />
            <span>写入本机 CS2</span>
          </button>
        </div>
        {deploy ? (
          <div className="travel-deploy">
            <p>{deploy.message}</p>
            <div>
              <code>{deploy.execCommand}</code>
              <button
                className="icon-button"
                aria-label="复制控制台指令"
                onClick={() => void copyValue("控制台指令", deploy.execCommand)}
              >
                <Copy />
              </button>
            </div>
          </div>
        ) : null}
      </section>
      <div className="toolbar">
        <label className="search">
          <input
            aria-label="搜索身份"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Steam、5E 或完美"
          />
        </label>
        <button className="button secondary" disabled={busy} onClick={() => void exportPack()}>
          <Download />
          <span>导出资料包</span>
        </button>
        <button className="button primary" disabled={busy} onClick={() => void importPack()}>
          <Upload />
          <span>导入资料包</span>
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="empty compact">
          <BookUser />
          <h2>还没有外出资料</h2>
          <p>
            在家用机用 TeamSpeak Unique ID 上传，或导出资料包带到网吧。切号仍只对已在本机记住的 Steam 账号开放。
          </p>
        </div>
      ) : (
        <ul className="travel-list">
          {filtered.map((item) => (
            <li key={item.steamId64} className="travel-card">
              <header>
                <strong>{identityTitle(item)}</strong>
                <span className={item.localAvailable ? "badge available" : "badge unavailable"}>
                  {item.localAvailable ? "本机可切号" : "仅资料，不可切号"}
                </span>
              </header>
              <dl>
                <TravelField
                  label="Steam 登录名"
                  value={item.accountName}
                  onCopy={() => void copyValue("Steam 登录名", item.accountName)}
                />
                <TravelField
                  label="Steam 昵称"
                  value={item.personaName}
                />
                <TravelPlatform
                  label="5E"
                  cred={item.fiveE}
                  revealed={Boolean(revealed[`${item.steamId64}-5e`])}
                  onReveal={() =>
                    setRevealed((current) => ({
                      ...current,
                      [`${item.steamId64}-5e`]: !current[`${item.steamId64}-5e`],
                    }))
                  }
                  onCopyAccount={() =>
                    void copyValue("5E 登录账号", item.fiveE?.loginAccount)
                  }
                  onCopyPassword={() =>
                    void copyValue("5E 密码", item.fiveE?.loginPassword)
                  }
                />
                <TravelPlatform
                  label="完美"
                  cred={item.perfectWorld}
                  revealed={Boolean(revealed[`${item.steamId64}-pw`])}
                  onReveal={() =>
                    setRevealed((current) => ({
                      ...current,
                      [`${item.steamId64}-pw`]: !current[`${item.steamId64}-pw`],
                    }))
                  }
                  onCopyAccount={() =>
                    void copyValue("完美登录账号", item.perfectWorld?.loginAccount)
                  }
                  onCopyPassword={() =>
                    void copyValue("完美密码", item.perfectWorld?.loginPassword)
                  }
                />
                <div>
                  <dt>CFG</dt>
                  <dd>
                    {item.cfg ? (
                      <span className="travel-cfg">
                        <span>
                          {item.cfg.name} · {item.cfg.fileName}
                        </span>
                        <button
                          className="icon-button"
                          aria-label={`复制${identityTitle(item)}的 CFG`}
                          onClick={() => void copyValue("CFG", item.cfg?.content)}
                        >
                          <Copy />
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => void exportCfg(item)}
                        >
                          导出 CFG
                        </button>
                      </span>
                    ) : (
                      <span className="muted-copy">未收录</span>
                    )}
                  </dd>
                </div>
                {item.remark ? (
                  <div>
                    <dt>备注</dt>
                    <dd className="pre-wrap">{item.remark}</dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TravelField({
  label,
  value,
  onCopy,
}: {
  label: string;
  value?: string;
  onCopy?: () => void;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span>{value || "未填写"}</span>
        {onCopy && value ? (
          <button className="icon-button" aria-label={`复制${label}`} onClick={onCopy}>
            <Copy />
          </button>
        ) : null}
      </dd>
    </div>
  );
}

function TravelPlatform({
  label,
  cred,
  revealed,
  onReveal,
  onCopyAccount,
  onCopyPassword,
}: {
  label: string;
  cred?: TravelPlatformCred;
  revealed: boolean;
  onReveal: () => void;
  onCopyAccount: () => void;
  onCopyPassword: () => void;
}) {
  if (!cred?.loginAccount && !cred?.loginPassword && !cred?.displayName) {
    return (
      <div>
        <dt>{label}</dt>
        <dd className="muted-copy">未填写</dd>
      </div>
    );
  }
  return (
    <div>
      <dt>{label}</dt>
      <dd className="travel-platform">
        <span>
          {cred.displayName ? `${cred.displayName} · ` : ""}
          {cred.loginAccount || "无登录账号"}
          {cred.loginPassword
            ? ` · ${revealed ? cred.loginPassword : "••••••"}`
            : ""}
        </span>
        {cred.loginAccount ? (
          <button
            className="icon-button"
            aria-label={`复制${label}登录账号`}
            onClick={onCopyAccount}
          >
            <Copy />
          </button>
        ) : null}
        {cred.loginPassword ? (
          <>
            <button
              className="icon-button"
              aria-label={revealed ? `隐藏${label}密码` : `显示${label}密码`}
              onClick={onReveal}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </button>
            <button
              className="icon-button"
              aria-label={`复制${label}密码`}
              onClick={onCopyPassword}
            >
              <Copy />
            </button>
          </>
        ) : null}
      </dd>
    </div>
  );
}
