import { z } from "zod";
import type { InquiryCreatedResponse } from "./contracts";

const optionalText=(max:number)=>z.string().trim().max(max).nullish().transform((value)=>value||null);
const contactSchema=z.object({
  fullName:z.string().trim().min(1).max(150),
  email:z.string().trim().email().max(254).nullish().transform((value)=>value?.toLowerCase()||null),
  phone:optionalText(40),
  preferredContact:z.enum(["email","phone","messaging"]).nullable(),
}).superRefine((value,context)=>{
  if(!value.email&&!value.phone)context.addIssue({code:"custom",path:["email"],message:"An email or phone is required"});
});
const attributionSchema=z.object({
  referral:optionalText(300),landingPage:optionalText(1000),referrer:optionalText(1000),
  utmSource:optionalText(200),utmMedium:optionalText(200),utmCampaign:optionalText(200),
  utmTerm:optionalText(200),utmContent:optionalText(200),capturedAt:z.string().datetime(),
});
const eventExtensionSchema=z.object({
  kind:z.literal("event"),eventFamily:optionalText(100),startDate:optionalText(10),endDate:optionalText(10),
  startTime:optionalText(5),endTime:optionalText(5),venueLocation:optionalText(300),
  guestCount:z.number().int().positive().max(100000).nullable(),services:z.array(z.string().trim().min(1).max(100)).max(20),
});
const consultingExtensionSchema=z.object({
  kind:z.literal("consulting"),organization:optionalText(300),offerServiceArea:optionalText(300),
  situationProblem:optionalText(4000),desiredOutcome:optionalText(4000),timeline:optionalText(300),
  budget:optionalText(300),countryRegion:optionalText(200),referralSource:optionalText(300),
});
const commandSchema=z.object({
  contact:contactSchema,
  inquiry:z.object({sourceChannel:z.string().trim().min(1).max(100),budgetContext:optionalText(300),customerNote:optionalText(4000)}),
  intake:z.object({formSchemaKey:z.string().trim().min(1).max(150),schemaVersion:z.number().int().positive(),origin:z.string().trim().min(1).max(300),payload:z.record(z.string(),z.unknown())}),
  attribution:attributionSchema,
  extension:z.discriminatedUnion("kind",[eventExtensionSchema,consultingExtensionSchema]),
  acknowledgementMessage:z.string().trim().min(1).max(500),
}).strict();

export type CreateInquiryCommand=z.input<typeof commandSchema>;
type ReplayRow={id:string;event_id:string|null;created_at:string};
const id=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll("-","")}`;

export async function createInquiry(db:D1Database,unparsed:CreateInquiryCommand,idempotencyKey:string,now:string):Promise<InquiryCreatedResponse>{
  const command=commandSchema.parse(unparsed);
  const payloadJson=JSON.stringify(command.intake.payload);
  if(new TextEncoder().encode(payloadJson).byteLength>16_384)throw new Error("Approved intake payload exceeds 16384 bytes");
  const replay=await findReplay(db,idempotencyKey);
  if(replay)return responseFor(replay,true,command.acknowledgementMessage);

  const existingContact=command.contact.email
    ? await db.prepare("SELECT id FROM contacts WHERE lower(email)=?").bind(command.contact.email).first<{id:string}>()
    : await db.prepare("SELECT id FROM contacts WHERE phone=?").bind(command.contact.phone).first<{id:string}>();
  const contactId=existingContact?.id??id("con");
  const inquiryId=id("inq");
  const eventId=command.extension.kind==="event"?id("evt"):null;
  const statements:D1PreparedStatement[]=[];
  if(existingContact){
    statements.push(db.prepare("UPDATE contacts SET full_name=?,email=COALESCE(?,email),phone=COALESCE(?,phone),preferred_contact=?,updated_at=? WHERE id=?")
      .bind(command.contact.fullName,command.contact.email,command.contact.phone,command.contact.preferredContact,now,contactId));
  }else{
    statements.push(db.prepare("INSERT INTO contacts (id,full_name,email,phone,preferred_contact,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(contactId,command.contact.fullName,command.contact.email,command.contact.phone,command.contact.preferredContact,now,now));
  }
  if(command.extension.kind==="event"){
    statements.push(db.prepare(`INSERT INTO events
      (id,event_family,start_date,end_date,start_time,end_time,venue_location,guest_count,blocks_capacity,scheduling_state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,0,'requested',?,?)`).bind(
      eventId,command.extension.eventFamily,command.extension.startDate,command.extension.endDate,
      command.extension.startTime,command.extension.endTime,command.extension.venueLocation,command.extension.guestCount,now,now,
    ));
  }
  statements.push(db.prepare(`INSERT INTO inquiries
    (id,contact_id,event_id,source_channel,workflow_state,budget_context,customer_note,idempotency_key,created_at,updated_at)
    VALUES (?,?,?,?,'new',?,?,?,?,?)`).bind(
    inquiryId,contactId,eventId,command.inquiry.sourceChannel,command.inquiry.budgetContext,command.inquiry.customerNote,idempotencyKey,now,now,
  ));
  if(command.extension.kind==="event"){
    statements.push(...[...new Set(command.extension.services)].map((service)=>db.prepare("INSERT INTO inquiry_services (inquiry_id,service_name) VALUES (?,?)").bind(inquiryId,service)));
  }else{
    const extension=command.extension;
    statements.push(db.prepare(`INSERT INTO consulting_details
      (inquiry_id,organization,offer_service_area,situation_problem,desired_outcome,timeline,budget,country_region,referral_source,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
      inquiryId,extension.organization,extension.offerServiceArea,extension.situationProblem,extension.desiredOutcome,
      extension.timeline,extension.budget,extension.countryRegion,extension.referralSource,now,now,
    ));
  }
  statements.push(
    db.prepare(`INSERT INTO intake_submissions
      (id,inquiry_id,form_schema_key,schema_version,origin,source_channel,referral,landing_page,referrer,utm_source,utm_medium,utm_campaign,utm_term,utm_content,captured_at,received_at,payload_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      id("int"),inquiryId,command.intake.formSchemaKey,command.intake.schemaVersion,command.intake.origin,
      command.inquiry.sourceChannel,command.attribution.referral,command.attribution.landingPage,command.attribution.referrer,
      command.attribution.utmSource,command.attribution.utmMedium,command.attribution.utmCampaign,
      command.attribution.utmTerm,command.attribution.utmContent,command.attribution.capturedAt,now,payloadJson,
    ),
    db.prepare(`INSERT INTO activities
      (id,inquiry_id,event_id,actor_kind,activity_type,metadata_json,created_at) VALUES (?,?,?,'customer','inquiry_created',?,?)`)
      .bind(id("act"),inquiryId,eventId,JSON.stringify({extension:command.extension.kind,formSchemaKey:command.intake.formSchemaKey,schemaVersion:command.intake.schemaVersion}),now),
  );
  try{
    await db.batch(statements);
  }catch(error){
    const racedReplay=await findReplay(db,idempotencyKey);
    if(racedReplay)return responseFor(racedReplay,true,command.acknowledgementMessage);
    throw error;
  }
  return responseFor({id:inquiryId,event_id:eventId,created_at:now},false,command.acknowledgementMessage);
}

async function findReplay(db:D1Database,key:string){
  return db.prepare("SELECT id,event_id,created_at FROM inquiries WHERE idempotency_key=?").bind(key).first<ReplayRow>();
}
function responseFor(row:ReplayRow,idempotentReplay:boolean,message:string):InquiryCreatedResponse{
  return{ok:true,inquiryId:row.id,eventId:row.event_id,createdAt:row.created_at,idempotentReplay,status:"received_for_review",message};
}
