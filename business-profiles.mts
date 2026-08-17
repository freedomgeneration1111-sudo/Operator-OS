export type BusinessCapabilities={
  event:boolean;
  schedule:boolean;
  capacity:boolean;
};
export type BusinessVocabulary={
  inquirySingular:string;
  inquiryPlural:string;
  customerSingular:string;
};
export type BusinessProfile={
  key:"focus"|"moses";
  businessName:string;
  shortName:string;
  appName:string;
  appDescription:string;
  logoUrl:string|null;
  capabilities:BusinessCapabilities;
  publicEventInquiry:boolean;
  messagingPrompt:string;
  publicChat:boolean;
  pushTopicPrefix:string;
  vocabulary:BusinessVocabulary;
};
type BuildProfile=BusinessProfile&{logoSource:string|null};

const profiles:Record<BusinessProfile["key"],BuildProfile>={
  focus:{
    key:"focus",businessName:"Focus Lab Productions",shortName:"Focus Lab",appName:"Focus Lab Operations",
    appDescription:"Internal CRM and responder workspace for Focus Lab Productions.",logoUrl:"/app-mark.svg",
    logoSource:"business/focus-lab/focus-lab-mark.svg",publicEventInquiry:true,publicChat:true,
    messagingPrompt:"Hi Focus Lab, I would like to discuss an event.",pushTopicPrefix:"fl",
    capabilities:{event:true,schedule:true,capacity:true},
    vocabulary:{inquirySingular:"inquiry",inquiryPlural:"inquiries",customerSingular:"customer"},
  },
  moses:{
    key:"moses",businessName:"Moses Jorgensen",shortName:"Moses",appName:"Moses Operations",
    appDescription:"Internal CRM and responder workspace for Moses Jorgensen.",logoUrl:null,logoSource:null,publicEventInquiry:false,publicChat:false,
    messagingPrompt:"Hi Moses, I would like to discuss consulting.",pushTopicPrefix:"mj",
    capabilities:{event:false,schedule:false,capacity:false},
    vocabulary:{inquirySingular:"inquiry",inquiryPlural:"inquiries",customerSingular:"client"},
  },
};

export function resolveBusinessProfile(value:string|undefined):BuildProfile{
  const key=value||"focus";
  if(key!=="focus"&&key!=="moses")throw new Error(`Invalid VITE_BUSINESS_PROFILE "${key}". Expected "focus" or "moses".`);
  return profiles[key];
}
export function resolveClientBusinessProfile(value:string|undefined):BusinessProfile{
  const {logoSource,...profile}=resolveBusinessProfile(value);
  void logoSource;
  return profile;
}
export type BusinessProfileKey=BusinessProfile["key"];
