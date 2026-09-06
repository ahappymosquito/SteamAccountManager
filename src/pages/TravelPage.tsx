/** 外出资料：用自己起的短名字和口令打开云存档，复制账号密码与 CFG。 */
import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  CloudUpload,
  Copy,
  Download,
  Eye,
  EyeOff,
  LogIn,
  Upload,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  AppError,
  CfgDeployReport,
  TravelIdentity,
  TravelPlatformCred,
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
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [deploy, setDeploy] = useState<CfgDeployReport | null>(null);

  const refresh = async () => {
    setItems(await api.travelIdentities());
  };

  useEffect(() => {
    void (async () => {
      try {
        const remembered = await api.rememberedVaultName();
        if (remembered) setName(remembered);
      } catch {
        /* 家用机才会记住名字，网吧打开不落盘 */
      }
      try {
        await refresh();
      } catch (error) {
        notify("error", errorMessage(error));
      }
    })();
  }, []);

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

  const credentials = () => {
    const nextName = name.trim();
    const nextPin = pin.trim();
    if (!nextName) {
      notify("error", "请填写名字");
      return null;
    }
    if (!nextPin) {
      notify("error", "请填写口令");
      return null;
    }
    return { name: nextName, pin: nextPin };
  };

  const runVault = async (action: () => Promise<void>) => {
    if (!credentials()) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openVault = () =>
    void runVault(async () => {
      const login = credentials();
      if (!login) return;
      const result = await api.replaceTravelVault(login.name, login.pin);
      await refresh();
      setDeploy(result.deploy);
      notify("success", result.deploy.message);
    });

  const uploadVault = () =>
    void runVault(async () => {
      const login = credentials();
      if (!login) return;
      await api.uploadTravelVault(login.name, login.pin);
      notify("success", "已按这个名字上传");
    });

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
      notify("success", `已导出 ${result.identityCount} 个身份`);
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
      notify("success", `已导入 ${result.identityCount} 个身份`);
    } catch (error) {
      notify("error", errorMessage(error) || "导入失败，请换一份外出资料包再试");
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
        </div>
      </header>
      <form
        className="travel-vault"
        onSubmit={(event) => {
          event.preventDefault();
          openVault();
        }}
      >
        <div className="travel-vault-row">
          <label className="search">
            <input
              aria-label="名字"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="名字"
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
            />
          </label>
          <label className="search pin">
            <input
              aria-label="口令"
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="口令"
              autoComplete="off"
              spellCheck={false}
              maxLength={8}
            />
          </label>
          <button className="button primary" disabled={busy} type="submit">
            <LogIn />
            <span>打开</span>
          </button>
          {items.length > 0 ? (
            <button
              className="button secondary"
              disabled={busy}
              type="button"
              onClick={uploadVault}
            >
              <CloudUpload />
              <span>上传</span>
            </button>
          ) : null}
        </div>
        {deploy ? (
          <div className="travel-deploy">
            <p>{deploy.message}</p>
            {deploy.execCommand ? (
              <div>
                <code>{deploy.execCommand}</code>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="复制控制台指令"
                  onClick={() => void copyValue("控制台指令", deploy.execCommand)}
                >
                  <Copy />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
      {items.length > 0 ? (
        <ul className="travel-list">
          {items.map((item) => (
            <li key={item.steamId64} className="travel-card">
              <header>
                <strong>{identityTitle(item)}</strong>
              </header>
              <dl>
                <TravelField
                  label="Steam 登录名"
                  value={item.accountName}
                  onCopy={() => void copyValue("Steam 登录名", item.accountName)}
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
                          type="button"
                          aria-label={`复制${identityTitle(item)}的 CFG`}
                          onClick={() => void copyValue("CFG", item.cfg?.content)}
                        >
                          <Copy />
                        </button>
                        <button
                          className="button secondary"
                          type="button"
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
              </dl>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="travel-usb">
        <button
          className="button secondary"
          disabled={busy}
          type="button"
          onClick={() => void importPack()}
        >
          <Upload />
          <span>导入 U 盘</span>
        </button>
        <button
          className="button secondary"
          disabled={busy}
          type="button"
          onClick={() => void exportPack()}
        >
          <Download />
          <span>导出 U 盘</span>
        </button>
      </div>
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
          <button className="icon-button" type="button" aria-label={`复制${label}`} onClick={onCopy}>
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
            type="button"
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
              type="button"
              aria-label={revealed ? `隐藏${label}密码` : `显示${label}密码`}
              onClick={onReveal}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </button>
            <button
              className="icon-button"
              type="button"
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
