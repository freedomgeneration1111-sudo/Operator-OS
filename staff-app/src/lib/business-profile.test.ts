import { describe,expect,it } from "vitest";
import { resolveBusinessProfile,resolveClientBusinessProfile } from "../../../business-profiles.mts";
import { navigationFor,routeEnabled } from "./business-profile";

const clientProfile=(key:"focus"|"moses")=>resolveClientBusinessProfile(key);
describe("business profile capabilities",()=>{
  it("keeps Focus event, schedule, and capacity capabilities",()=>{const profile=clientProfile("focus");expect(profile.capabilities).toEqual({event:true,schedule:true,capacity:true,availability:true,whatsappChannel:false,opsNotifyEmail:true,opsNotifyPush:true,websiteManagement:true});expect(navigationFor(profile).map((item)=>item.label)).toContain("Schedule");});
  it("removes all event capabilities and schedule routing for Moses",()=>{const profile=clientProfile("moses");expect(profile.capabilities).toEqual({event:false,schedule:false,capacity:false,availability:false,whatsappChannel:true,opsNotifyEmail:true,opsNotifyPush:true,websiteManagement:false});expect(navigationFor(profile).map((item)=>item.label)).not.toContain("Schedule");expect(routeEnabled("/schedule",profile)).toBe(false);});
  it("keeps Focus public event inquiry enabled and Moses public event inquiry disabled, both with public chat enabled",()=>{expect(clientProfile("focus")).toMatchObject({publicEventInquiry:true,publicChat:true});expect(clientProfile("moses")).toMatchObject({publicEventInquiry:false,publicChat:true});});
  it("fails fast for an invalid build profile",()=>expect(()=>resolveBusinessProfile("unknown")).toThrow(/Invalid VITE_BUSINESS_PROFILE/));
});
