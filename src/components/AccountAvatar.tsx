/** Cached Steam avatar and profile frame with a neutral, accessible fallback. */
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Account } from "../lib/types";

const versionedAssetUrl = (path: string, version?: string) => {
  const url = convertFileSrc(path);
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
};

export function AccountAvatar({ account, large = false }: { account: Account; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  useEffect(() => setFailed(false), [account.avatarPath, account.avatarVersion, account.updatedAt]);
  useEffect(() => setFrameFailed(false), [account.avatarFramePath, account.avatarFrameVersion, account.updatedAt]);
  const letter = (account.personaName || account.alias || account.accountName || "?").slice(0, 1).toUpperCase();
  return <div className={`avatar neutral${large ? " large" : ""}`}>
    <div className="avatar-content">
      {account.avatarPath && !failed
        ? <img src={versionedAssetUrl(account.avatarPath, account.avatarVersion)} alt="" onError={() => setFailed(true)} />
        : <span>{letter}</span>}
    </div>
    {account.avatarFramePath && !frameFailed && (
      <img
        className="avatar-frame"
        src={versionedAssetUrl(account.avatarFramePath, account.avatarFrameVersion)}
        alt=""
        onError={() => setFrameFailed(true)}
      />
    )}
  </div>;
}
