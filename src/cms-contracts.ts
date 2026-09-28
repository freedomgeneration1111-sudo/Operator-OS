import { z } from "zod";

export const CMS_SCHEMA_VERSION=1 as const;
export const FOCUS_PRICING_KEYS=[
  "weddingDjCore","weddingDjCeremonyReception","weddingProductionEnhanced","ceremonySound",
  "saSingleEvent","saWeddingReception","saFullCelebration","saBaraat","southAsianCelebrationMedia",
  "party3h","party4h","party5h","partyPhotography","partyHighlightVideo",
  "corporateDjHourly","corporateAvBasic","corporateProductionHalfDay","corporateProductionFullDay","corporateMedia","corporateLivestream",
  "weddingPhotography","weddingVideography","photoVideoBundle","engagementSession","socialContent",
  "digitalPhotoBooth","booth360","dancingOnClouds","coldSparks","uplighting","monogram","ledWall",
] as const;

const pricingItemSchema=z.object({
  amount:z.number().int().min(0).max(10_000_000),
  mode:z.enum(["exact","from","hourly","custom"]),
  label:z.string().trim().min(1).max(120),
}).strict();

export const pricingDocumentSchema=z.object({
  schemaVersion:z.literal(CMS_SCHEMA_VERSION),
  values:z.record(z.string(),pricingItemSchema),
}).strict().superRefine((document,context)=>{
  const expected=new Set<string>(FOCUS_PRICING_KEYS);const actual=Object.keys(document.values);
  const missing=FOCUS_PRICING_KEYS.filter((key)=>!(key in document.values));
  const extra=actual.filter((key)=>!expected.has(key));
  if(missing.length)context.addIssue({code:"custom",path:["values"],message:`Missing stable pricing identifiers: ${missing.join(", ")}`});
  if(extra.length)context.addIssue({code:"custom",path:["values"],message:`Unsupported pricing identifiers: ${extra.join(", ")}`});
});

const faqItemSchema=z.object({
  id:z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{2,79}$/,"Use a stable lowercase FAQ identifier"),
  question:z.string().trim().min(1).max(300),
  answer:z.string().trim().min(1).max(3000),
}).strict();
const faqCollectionSchema=z.array(faqItemSchema).max(100).superRefine((items,context)=>{
  const seen=new Set<string>();
  items.forEach((item,index)=>{if(seen.has(item.id))context.addIssue({code:"custom",path:[index,"id"],message:"FAQ identifiers must be unique within a collection"});seen.add(item.id);});
});
export const faqDocumentSchema=z.object({schemaVersion:z.literal(CMS_SCHEMA_VERSION),common:faqCollectionSchema,pricing:faqCollectionSchema}).strict();
export const cmsInitializationSchema=z.object({pricing:pricingDocumentSchema,faqs:faqDocumentSchema}).strict();

export type CmsDocumentKey="pricing"|"faqs";
export type PricingDocument=z.infer<typeof pricingDocumentSchema>;
export type FaqDocument=z.infer<typeof faqDocumentSchema>;
export type CmsDocument=PricingDocument|FaqDocument;
export function parseCmsDocument(key:CmsDocumentKey,value:unknown):CmsDocument{return key==="pricing"?pricingDocumentSchema.parse(value):faqDocumentSchema.parse(value);}
