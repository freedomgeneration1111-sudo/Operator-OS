import { resolveClientBusinessProfile } from "../business-profiles.mts";

export type CmsAvailability={
  available:boolean;
  reason:"available"|"business_disabled"|"configuration_disabled"|"binding_missing";
};

export function resolveCmsAvailability(env:Pick<Env,"BUSINESS_PROFILE"|"CMS_ENABLED"|"CMS_DB">):CmsAvailability{
  const profile=resolveClientBusinessProfile(env.BUSINESS_PROFILE);
  if(!profile.capabilities.websiteManagement)return{available:false,reason:"business_disabled"};
  if(env.CMS_ENABLED!=="true")return{available:false,reason:"configuration_disabled"};
  if(!env.CMS_DB)return{available:false,reason:"binding_missing"};
  return{available:true,reason:"available"};
}
