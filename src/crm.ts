import { z } from "zod";
import { requirePermission,type StaffIdentity } from "./auth";
import { assessScheduling } from "./scheduling";
import { getInquiryDetail,listBlockingWindows,listInquiries,newId,recordActivity } from "./repository";

const workflowSchema=z.object({state:z.enum(["new","reviewing","qualified","quoted","won","lost","archived"])}).strict();
const noteSchema=z.object({body:z.string().trim().min(1).max(4000)}).strict();
const assignmentSchema=z.object({responderId:z.string().min(1).max(100),assigned:z.boolean()}).strict();
const capacitySchema=z.object({blocksCapacity:z.boolean()}).strict();

export async function handleCrm(request:Request,db:D1Database,path:string,capacity:number,actor:StaffIdentity):Promise<Response>{
  requirePermission(actor,"crm:read");
  if(request.method==="GET"&&path==="/v1/internal/inquiries")return Response.json({ok:true,inquiries:await listInquiries(db,new URL(request.url).searchParams.get("query"))});
  const match=path.match(/^\/v1\/internal\/inquiries\/([^/]+)(?:\/(workflow|notes|assignment|capacity|conflicts))?$/);
  if(!match)return Response.json({ok:false,error:{code:"not_found",message:"Route not found"}},{status:404});
  const inquiryId=decodeURIComponent(match[1]!);const action=match[2];const detail=await getInquiryDetail(db,inquiryId);
  if(!detail)return Response.json({ok:false,error:{code:"not_found",message:"Inquiry not found"}},{status:404});
  if(request.method==="GET"&&!action)return Response.json({ok:true,...detail});
  const row=detail.inquiry as Record<string,unknown>;const now=new Date().toISOString();const eventId=value(row.event_id);
  if(request.method==="PATCH"&&action==="workflow"){
    requirePermission(actor,"workflow:update");const parsed=workflowSchema.safeParse(await request.json());if(!parsed.success)return invalid(parsed.error.flatten().fieldErrors);
    await db.prepare("UPDATE inquiries SET workflow_state=?,updated_at=? WHERE id=?").bind(parsed.data.state,now,inquiryId).run();
    await recordActivity(db,inquiryId,eventId,"workflow_changed",actor.id,{state:parsed.data.state},now);
    return Response.json({ok:true,state:parsed.data.state,updatedAt:now});
  }
  if(request.method==="POST"&&action==="notes"){
    requirePermission(actor,"notes:create");const parsed=noteSchema.safeParse(await request.json());if(!parsed.success)return invalid(parsed.error.flatten().fieldErrors);
    const noteId=newId("note");await db.prepare("INSERT INTO internal_notes (id,inquiry_id,author_responder_id,body,created_at) VALUES (?,?,?,?,?)").bind(noteId,inquiryId,actor.id,parsed.data.body,now).run();
    await recordActivity(db,inquiryId,eventId,"internal_note_added",actor.id,{noteId},now);return Response.json({ok:true,noteId,createdAt:now},{status:201});
  }
  if(request.method==="PATCH"&&action==="assignment"){
    const parsed=assignmentSchema.safeParse(await request.json());if(!parsed.success)return invalid(parsed.error.flatten().fieldErrors);
    requirePermission(actor,parsed.data.responderId===actor.id?"assignment:self":"assignment:manage");
    const target=await db.prepare("SELECT id FROM responders WHERE id=? AND active=1").bind(parsed.data.responderId).first();if(!target)return Response.json({ok:false,error:{code:"responder_not_found",message:"Active responder not found"}},{status:404});
    if(parsed.data.assigned)await db.prepare("INSERT OR REPLACE INTO assignments (inquiry_id,responder_id,assigned_at,assigned_by) VALUES (?,?,?,?)").bind(inquiryId,parsed.data.responderId,now,actor.id).run();
    else await db.prepare("DELETE FROM assignments WHERE inquiry_id=? AND responder_id=?").bind(inquiryId,parsed.data.responderId).run();
    await recordActivity(db,inquiryId,eventId,parsed.data.assigned?"responder_assigned":"responder_unassigned",actor.id,{responderId:parsed.data.responderId},now);
    return Response.json({ok:true,assigned:parsed.data.assigned,updatedAt:now});
  }
  if(request.method==="PATCH"&&action==="capacity"){
    if(!eventId)return eventExtensionRequired();
    requirePermission(actor,"capacity:manage");const parsed=capacitySchema.safeParse(await request.json());if(!parsed.success)return invalid(parsed.error.flatten().fieldErrors);
    await db.prepare("UPDATE events SET blocks_capacity=?,updated_at=? WHERE id=?").bind(parsed.data.blocksCapacity?1:0,now,eventId).run();
    await recordActivity(db,inquiryId,eventId,"capacity_blocking_changed",actor.id,{blocksCapacity:parsed.data.blocksCapacity},now);return Response.json({ok:true,blocksCapacity:parsed.data.blocksCapacity,updatedAt:now});
  }
  if(request.method==="GET"&&action==="conflicts"){
    if(!eventId)return eventExtensionRequired();
    const proposed={id:eventId,startDate:value(row.start_date),endDate:value(row.end_date),startTime:value(row.start_time),endTime:value(row.end_time),blocksCapacity:Boolean(row.blocks_capacity),schedulingState:value(row.scheduling_state)??undefined};
    if(!proposed.startDate)return Response.json({ok:true,assessment:assessScheduling(proposed,[],capacity)});
    const windows=await listBlockingWindows(db,proposed.startDate,proposed.endDate??proposed.startDate);return Response.json({ok:true,assessment:assessScheduling(proposed,windows.filter((item)=>item.id!==proposed.id),capacity)});
  }
  return Response.json({ok:false,error:{code:"method_not_allowed",message:"Method not allowed"}},{status:405});
}
const value=(input:unknown)=>typeof input==="string"?input:null;
function invalid(fields:Record<string,string[]|undefined>){return Response.json({ok:false,error:{code:"validation_error",message:"Request validation failed",fields}},{status:422});}
function eventExtensionRequired(){return Response.json({ok:false,error:{code:"event_extension_required",message:"This operation requires an Event extension"}},{status:409});}
