import type { BusinessProfile } from "../../../business-profiles.mts";

declare const __BUSINESS_PROFILE__:BusinessProfile;
export const businessProfile=__BUSINESS_PROFILE__;
export type NavigationItem={href:string;label:string};

export function navigationFor(profile:BusinessProfile,canManageWebsite=false):NavigationItem[]{
  return [
    {href:"/inbox",label:"Inbox"},
    ...(profile.capabilities.schedule?[{href:"/schedule",label:"Schedule"}]:[]),
    {href:"/chat",label:"Chat"},
    {href:"/search",label:"Search"},
    ...(profile.capabilities.websiteManagement&&canManageWebsite?[{href:"/website",label:"Website"}]:[]),
    {href:"/settings",label:"Status"},
  ];
}
export function routeEnabled(route:string,profile:BusinessProfile){
  if(route.startsWith("/schedule"))return profile.capabilities.schedule;
  if(route.startsWith("/website"))return profile.capabilities.websiteManagement;
  return true;
}
export function serviceWorkerVersion(profile:BusinessProfile){return `operator-os-${profile.key}-sw-v5`;}
