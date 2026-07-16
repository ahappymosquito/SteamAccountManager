/** Accessible account profile editor with schema-backed validation. */
import * as Dialog from "@radix-ui/react-dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { X } from "lucide-react";
import type { Account, ProfileInput } from "../lib/types";

export const profileSchema=z.object({steamId64:z.string().regex(/^\d{17}$/,"SteamID64 必须是 17 位数字"),alias:z.string().max(80,"别名不能超过 80 个字符").optional(),remark:z.string().max(2000,"备注不能超过 2000 个字符").optional(),groupName:z.string().max(80).optional(),color:z.string().max(30).optional(),favorite:z.boolean(),tagsText:z.string().max(500)});
const schema=profileSchema;
type Form=z.infer<typeof schema>;
export function ProfileDialog({account,open,onOpenChange,onSave}:{account?:Account;open:boolean;onOpenChange:(v:boolean)=>void;onSave:(input:ProfileInput)=>Promise<void>}){
 const {register,handleSubmit,formState:{errors,isSubmitting}}=useForm<Form>({resolver:zodResolver(schema),values:{steamId64:account?.steamId64??"",alias:account?.alias??"",remark:account?.remark??"",groupName:account?.groupName??"",color:account?.color??"",favorite:account?.favorite??false,tagsText:account?.tags.join(", ")??""}});
 const submit=handleSubmit(async v=>{await onSave({steamId64:v.steamId64,alias:v.alias||undefined,remark:v.remark||undefined,groupName:v.groupName||undefined,color:v.color||undefined,favorite:v.favorite,tags:v.tagsText.split(/[,，]/).map(s=>s.trim()).filter(Boolean)});onOpenChange(false)});
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className="dialog"><header><div><Dialog.Title>{account?"编辑账号资料":"新增手工账号资料"}</Dialog.Title><Dialog.Description>只保存备注资料，不保存密码或登录凭据。</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="关闭"><X/></Dialog.Close></header><form onSubmit={submit} className="form-grid"><label>SteamID64<input readOnly={Boolean(account)} {...register("steamId64")}/><span className="field-error">{errors.steamId64?.message}</span></label><label>自定义别名<input {...register("alias")}/></label><label>分组<input {...register("groupName")}/></label><label>颜色<input placeholder="例如：olive" {...register("color")}/></label><label className="span-2">标签<input placeholder="使用逗号分隔" {...register("tagsText")}/></label><label className="span-2">备注<textarea rows={5} {...register("remark")}/><span className="field-error">{errors.remark?.message}</span></label><label className="check span-2"><input type="checkbox" {...register("favorite")}/>收藏此账号</label><footer className="span-2"><Dialog.Close className="button secondary" type="button">取消</Dialog.Close><button className="button primary" disabled={isSubmitting}>{isSubmitting?"正在保存":"保存资料"}</button></footer></form></Dialog.Content></Dialog.Portal></Dialog.Root>
}
