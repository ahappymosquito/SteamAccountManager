/** Cached Steam avatar and profile frame with a neutral, accessible fallback. */
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Account } from "../lib/types";

export function AccountAvatar({ account, large = false }: { account: Account; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  useEffect(() => setFailed(false), [account.avatarPath, account.updatedAt]);
  useEffect(() => setFrameFailed(false), [account.avatarFramePath, account.updatedAt]);
  const letter = (account.personaName || account.alias || account.accountName || "?").slice(0, 1).toUpperCase();
  return <div className={`avatar neutral${large ? " large" : ""}`}>
    <div className="avatar-content">
      {account.avatarPath && !failed
        ? <img src={convertFileSrc(account.avatarPath)} alt="" onError={() => setFailed(true)} />
        : <span>{letter}</span>}
    </div>
    {account.avatarFramePath && !frameFailed && (
      <img
        className="avatar-frame"
        src={convertFileSrc(account.avatarFramePath)}
        alt=""
        onError={() => setFrameFailed(true)}
      />
    )}
  </div>;
}
