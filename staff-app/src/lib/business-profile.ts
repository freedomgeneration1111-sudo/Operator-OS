import type { BusinessProfile } from "../../../business-profiles.mts";

declare const __BUSINESS_PROFILE__:BusinessProfile;
export const businessProfile=__BUSINESS_PROFILE__;
export type NavigationItem={href:string;label:string};

export function navigationFor(profile:BusinessProfile):NavigationItem[]{
  return [
    {href:"/inbox",label:"Inbox"},
    ...(profile.capabilities.schedule?[{href:"/schedule",label:"Schedule"}]:[]),
    {href:"/chat",label:"Chat"},
    {href:"/search",label:"Search"},
    {href:"/settings",label:"Status"},
  ];
}
export function routeEnabled(route:string,profile:BusinessProfile){
  return !route.startsWith("/schedule")||profile.capabilities.schedule;
}
export function serviceWorkerVersion(profile:BusinessProfile){return `operator-os-${profile.key}-sw-v5`;}
