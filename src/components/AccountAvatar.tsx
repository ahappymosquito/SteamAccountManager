/** Local Steam avatar with a neutral, accessible fallback when cached imagery is unavailable. */
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Account } from "../lib/types";

export function AccountAvatar({ account, large = false }: { account: Account; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [account.avatarPath, account.updatedAt]);
  const letter = (account.personaName || account.alias || account.accountName || "?").slice(0, 1).toUpperCase();
  return <div className={`avatar neutral${large ? " large" : ""}`}>
    {account.avatarPath && !failed
      ? <img src={convertFileSrc(account.avatarPath)} alt="" onError={() => setFailed(true)} />
      : <span>{letter}</span>}
  </div>;
}
