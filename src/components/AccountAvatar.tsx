/** Local Steam avatar with a neutral, accessible fallback when cached imagery is unavailable. */
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImageOff } from "lucide-react";
import type { Account } from "../lib/types";

export function AccountAvatar({ account, large = false }: { account: Account; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [account.avatarPath]);
  const letter = (account.personaName || account.accountName || "?").slice(0, 1).toUpperCase();
  return <div className={`avatar neutral${large ? " large" : ""}`}>
    {account.avatarPath && !failed
      ? <img src={convertFileSrc(account.avatarPath)} alt="" onError={() => setFailed(true)} />
      : <span>{failed ? <ImageOff aria-label="头像加载失败" /> : letter}</span>}
  </div>;
}
