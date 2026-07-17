/** Guided wait surface while the user signs in through the official Steam client. */
import * as Dialog from "@radix-ui/react-dialog";
import { LoaderCircle, ShieldCheck, X } from "lucide-react";
import type { SteamLoginSession } from "../lib/types";

export function SteamLoginDialog({ session, open, onCancel }: { session?: SteamLoginSession; open: boolean; onCancel: () => void }) {
  return <Dialog.Root open={open}><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className="dialog compact login-wait"><header><div><Dialog.Title>在 Steam 中登录账号</Dialog.Title><Dialog.Description>Steam 已重新启动。请在官方登录窗口完成登录，并勾选“记住我”。</Dialog.Description></div><button className="icon-button" aria-label="取消等待" onClick={onCancel}><X /></button></header><div className="login-wait-body"><LoaderCircle className="spinner-icon"/><strong>正在等待 Steam 完成登录</strong><p>检测成功后，账号列表会自动刷新。应用不会读取或传递密码。</p><div className="safe-line"><ShieldCheck/>仅检测本地登录状态</div>{session && <small>最长等待 5 分钟</small>}</div><footer><button className="button secondary" onClick={onCancel}>取消等待</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
