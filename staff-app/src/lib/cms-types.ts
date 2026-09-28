export type PricingMode="exact"|"from"|"hourly"|"custom";
export type PricingDocument={schemaVersion:1;values:Record<string,{amount:number;mode:PricingMode;label:string}>};
export type FaqItem={id:string;question:string;answer:string};
export type FaqDocument={schemaVersion:1;common:FaqItem[];pricing:FaqItem[]};
export type CmsDocumentKey="pricing"|"faqs";
export type CmsContent=PricingDocument|FaqDocument;
export type CmsRevision<T extends CmsContent=CmsContent>={revisionId:string;documentKey:CmsDocumentKey;sequence:number;schemaVersion:number;content:T;actor:{id:string;displayName:string};createdAt:string;restoredFromRevisionId:string|null};
export type CmsState={ok:true;initialized:boolean;documents:{pricing:CmsRevision<PricingDocument>|null;faqs:CmsRevision<FaqDocument>|null}};
export type CmsHistory={ok:true;documentKey:CmsDocumentKey;revisions:CmsRevision[]};
