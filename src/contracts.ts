import { z } from "zod";

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || undefined);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const isoTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

export const inquiryRequestSchema = z.object({
  eventType: requiredText(100),
  date: isoDate,
  endDate: isoDate.optional(),
  startTime: isoTime.optional(),
  endTime: isoTime.optional(),
  location: optionalText(300),
  services: z.array(requiredText(100)).max(20).default([]),
  guests: z.union([z.number().int().positive().max(100000), z.string().regex(/^\d{1,6}$/).transform(Number)]).optional(),
  budget: optionalText(100),
  name: requiredText(150),
  email: z.string().trim().email().max(254),
  phone: optionalText(40),
  contact: z.enum(["email", "phone"]),
  note: optionalText(4000),
  source: optionalText(100),
  referral: optionalText(300),
  landingPage: optionalText(1000),
  referrer: optionalText(1000),
  utmSource: optionalText(200),
  utmMedium: optionalText(200),
  utmCampaign: optionalText(200),
  utmTerm: optionalText(200),
  utmContent: optionalText(200),
  availabilityChecked: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.endDate && value.endDate < value.date) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "End date cannot be before start date" });
  }
  if (value.contact === "phone" && !value.phone) {
    context.addIssue({ code: "custom", path: ["phone"], message: "Phone is required for phone contact" });
  }
  if (Boolean(value.startTime) !== Boolean(value.endTime)) {
    context.addIssue({ code: "custom", path: ["startTime"], message: "Start and end times must be supplied together" });
  }
});

export type InquiryRequest = z.infer<typeof inquiryRequestSchema>;
export type InquiryCreatedResponse = {
  ok: true; inquiryId: string; eventId: string|null; createdAt: string;
  idempotentReplay: boolean; status: "received_for_review"; message: string;
};
export type FocusInquiryCreatedResponse=InquiryCreatedResponse&{eventId:string};

export const consultingInquirySchema=z.object({
  name:requiredText(150),
  email:z.string().trim().email().max(254),
  phone:optionalText(40),
  preferredContact:z.enum(["email","phone","messaging"]).default("email"),
  organization:optionalText(300),
  offerServiceArea:optionalText(300),
  situationProblem:requiredText(4000),
  desiredOutcome:optionalText(4000),
  timeline:optionalText(300),
  budget:optionalText(300),
  countryRegion:optionalText(200),
  referralSource:optionalText(300),
  note:optionalText(4000),
  source:optionalText(100),
  landingPage:optionalText(1000),
  referrer:optionalText(1000),
  utmSource:optionalText(200),
  utmMedium:optionalText(200),
  utmCampaign:optionalText(200),
  utmTerm:optionalText(200),
  utmContent:optionalText(200),
  firstTouchCapturedAt:z.string().datetime().optional(),
  currentPage:optionalText(1000),
  currentUtmSource:optionalText(200),
  currentUtmMedium:optionalText(200),
  currentUtmCampaign:optionalText(200),
  currentUtmTerm:optionalText(200),
  currentUtmContent:optionalText(200),
  pageType:optionalText(100),
  contentSlug:optionalText(200),
}).strict().superRefine((value,context)=>{
  if(value.preferredContact==="phone"&&!value.phone)context.addIssue({code:"custom",path:["phone"],message:"Phone is required for phone contact"});
});
export type ConsultingInquiryInput=z.infer<typeof consultingInquirySchema>;
export type ApiErrorResponse = { ok: false; error: { code: string; message: string; fields?: Record<string,string[]> } };
export type ChatStatusResponse = {
  state: "live" | "async" | "unavailable";
  label: "Live Chat" | "Send us a DM" | "Messaging unavailable";
  destinationUrl: string | null; checkedAt: string;
};
