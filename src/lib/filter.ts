/** Deterministic account filtering used by the account toolbar. */
import type { Account } from "./types";
export function filterAccounts(accounts:Account[],query:string,localOnly=false,favoriteOnly=false,group=""){const q=query.trim().toLocaleLowerCase();return accounts.filter(a=>(!localOnly||a.localAvailable)&&(!favoriteOnly||a.favorite)&&(!group||a.groupName===group)&&(!q||[a.alias,a.personaName,a.accountName,a.steamId64,a.remark,...a.tags].some(v=>v?.toLocaleLowerCase().includes(q))))}
