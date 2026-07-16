/** Profile form schema rejects unsafe or malformed identifiers. */
import { describe,expect,it } from "vitest";
import { profileSchema } from "./ProfileDialog";
describe("profileSchema",()=>{it("rejects malformed SteamID64",()=>{const result=profileSchema.safeParse({steamId64:"123",alias:"",remark:"",groupName:"",color:"",favorite:false,tagsText:""});expect(result.success).toBe(false)});it("accepts non-sensitive profile data",()=>{expect(profileSchema.safeParse({steamId64:"76561198000000001",alias:"主力",remark:"",groupName:"",color:"",favorite:true,tagsText:"竞技"}).success).toBe(true)})});
