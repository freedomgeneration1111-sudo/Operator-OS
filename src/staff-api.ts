import { createConfiguredMessagingProvider,resolveChatStatus } from "./messaging";
import { assessScheduling,type SchedulingWindow } from "./scheduling";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const workflowStates = new Set(["new","reviewing","qualified","quoted","won","lost","archived"]);

export async function handleStaffApi(request: Request,env: Env,path: string,capacity: number,actor: import("./auth").StaffIdentity): Promise<Response|null> {
  if (path === "/v1/internal/me" && request.method === "GET") return currentUser(env.DB,actor,new Date().toISOString());
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (path === "/v1/internal/responders") return listResponders(env.DB,new Date().toISOString());
  if (path === "/v1/internal/status") return operationsStatus(env,new Date().toISOString());
  if (path === "/v1/internal/inbox") return inbox(env.DB,url.searchParams);
  if (path === "/v1/internal/schedule") return schedule(env.DB,url.searchParams,capacity);
  if (path === "/v1/internal/conversations") return conversations(env.DB,url.searchParams,actor.id);
  return null;
}

async function listResponders(db: D1Database,now: string) {
  const result = await db.prepare(`SELECT r.id,r.display_label,r.active,r.role,p.available,p.heartbeat_at,p.expires_at,
    CASE WHEN r.active=1 AND p.available=1 AND p.expires_at>? THEN 1 ELSE 0 END AS currently_available
    FROM responders r LEFT JOIN responder_presence p ON p.responder_id=r.id
    WHERE r.active=1 ORDER BY r.display_label`).bind(now).all();
  return Response.json({ ok:true,responders:result.results });
}

async function operationsStatus(env: Env,now: string) {
  const provider = createConfiguredMessagingProvider(env.MESSAGING_PROVIDER,env.MESSAGING_DESTINATION_URL);
  const [chat,responders] = await Promise.all([
    resolveChatStatus(env.DB,provider,now),
    env.DB.prepare(`SELECT r.id,r.display_label,p.heartbeat_at,p.expires_at FROM responders r
      JOIN responder_presence p ON p.responder_id=r.id
      WHERE r.active=1 AND p.available=1 AND p.expires_at>? ORDER BY r.display_label`).bind(now).all(),
  ]);
  return Response.json({
    ok:true,chat,activeResponders:responders.results,
    messaging:{ configured:Boolean(provider),provider:provider?.id ?? null },
    presenceTimeoutSeconds:positiveInteger(env.PRESENCE_TIMEOUT_SECONDS,120),
    eventCapacity:positiveInteger(env.CONCURRENT_EVENT_CAPACITY,1),
  });
}

async function inbox(db: D1Database,params: URLSearchParams) {
  const query = bounded(params.get("query"),120);
  const workflow = params.get("workflow");
  const assignment = bounded(params.get("assignment"),100);
  const eventFamily = bounded(params.get("eventFamily"),100);
  const date = params.get("date");
  const limit = clampInteger(params.get("limit"),1,50,25);
  const offset = clampInteger(params.get("offset"),0,5000,0);
  if (workflow && !workflowStates.has(workflow)) return invalid("Invalid workflow filter");
  if (date && !ISO_DATE.test(date)) return invalid("Invalid date filter");

  const conditions: string[] = [];
  const values: Array<string|number> = [];
  if (query) {
    const term = `%${query}%`;
    conditions.push("(c.full_name LIKE ? OR c.email LIKE ? OR i.id LIKE ? OR e.venue_location LIKE ? OR e.event_family LIKE ? OR e.start_date LIKE ? OR i.workflow_state LIKE ?)");
    values.push(term,term,term,term,term,term,term);
  }
  if (workflow) { conditions.push("i.workflow_state=?");values.push(workflow); }
  if (eventFamily) { conditions.push("e.event_family=?");values.push(eventFamily); }
  if (date) { conditions.push("e.start_date<=? AND COALESCE(e.end_date,e.start_date)>=?");values.push(date,date); }
  if (assignment === "unassigned") conditions.push("NOT EXISTS (SELECT 1 FROM assignments ax WHERE ax.inquiry_id=i.id)");
  else if (assignment) { conditions.push("EXISTS (SELECT 1 FROM assignments ax WHERE ax.inquiry_id=i.id AND ax.responder_id=?)");values.push(assignment); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const from = `FROM inquiries i JOIN contacts c ON c.id=i.contact_id JOIN events e ON e.id=i.event_id ${where}`;
  const [rows,count] = await db.batch([
    db.prepare(`SELECT i.id,i.workflow_state,i.source_channel,i.created_at,i.updated_at,c.full_name,
      e.id AS event_id,e.event_family,e.start_date,e.end_date,e.start_time,e.end_time,e.venue_location,e.blocks_capacity,e.scheduling_state,
      (SELECT GROUP_CONCAT(service_name,'|') FROM inquiry_services s WHERE s.inquiry_id=i.id) AS services,
      (SELECT GROUP_CONCAT(r.display_label,'|') FROM assignments a JOIN responders r ON r.id=a.responder_id WHERE a.inquiry_id=i.id) AS assignee_labels,
      (SELECT GROUP_CONCAT(a.responder_id,'|') FROM assignments a WHERE a.inquiry_id=i.id) AS assignee_ids
      ${from} ORDER BY CASE WHEN i.workflow_state='new' THEN 0 ELSE 1 END,i.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...values,limit,offset),
    db.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...values),
  ]);
  const total = Number((count!.results[0] as { total?:number }|undefined)?.total ?? 0);
  return Response.json({ ok:true,inquiries:rows!.results,page:{ limit,offset,total,hasMore:offset+limit<total } });
}

async function schedule(db: D1Database,params: URLSearchParams,capacity: number) {
  const start = params.get("start");
  const end = params.get("end");
  const state = params.get("state");
  if (!start || !end || !ISO_DATE.test(start) || !ISO_DATE.test(end) || end<start) return invalid("A valid start and end date range is required");
  const values: string[] = [start,end];
  const stateFilter = state && state !== "all" ? "AND e.scheduling_state=?" : "";
  if (state && state !== "all") values.push(state);
  const result = await db.prepare(`SELECT e.id,e.event_family,e.start_date,e.end_date,e.start_time,e.end_time,e.venue_location,
    e.blocks_capacity,e.scheduling_state,i.id AS inquiry_id,i.workflow_state,c.full_name,
    (SELECT GROUP_CONCAT(service_name,'|') FROM inquiry_services s WHERE s.inquiry_id=i.id) AS services
    FROM events e JOIN inquiries i ON i.event_id=e.id JOIN contacts c ON c.id=i.contact_id
    WHERE e.start_date IS NOT NULL AND COALESCE(e.end_date,e.start_date)>=? AND e.start_date<=? ${stateFilter}
    ORDER BY e.start_date,e.start_time,e.created_at LIMIT 250`).bind(...values).all<Record<string,unknown>>();
  const windows = result.results.map(toWindow);
  const events = result.results.map((row,index) => ({ ...row,assessment:assessScheduling(windows[index]!,windows.filter((_,other) => other!==index),capacity) }));
  return Response.json({ ok:true,range:{ start,end },capacity,events });
}

async function conversations(db: D1Database,params: URLSearchParams,responderId: string) {
  const query = bounded(params.get("query"),120);
  const term = query ? `%${query}%` : null;
  const result = term
    ? await db.prepare(`SELECT cv.id,cv.provider,cv.external_conversation_id,cv.channel_state,cv.updated_at,
        cv.inquiry_id,cv.event_id,cv.assigned_responder_id,cv.last_message_at,c.full_name,e.event_family,e.start_date,
        (SELECT COUNT(*) FROM conversation_messages cm WHERE cm.conversation_id=cv.id AND cm.sender_kind='customer' AND cm.sequence>COALESCE((SELECT cr.last_read_sequence FROM conversation_reads cr WHERE cr.conversation_id=cv.id AND cr.responder_id=?),0)) AS unread_count FROM conversations cv
        JOIN contacts c ON c.id=cv.contact_id LEFT JOIN events e ON e.id=cv.event_id
        WHERE c.full_name LIKE ? OR cv.external_conversation_id LIKE ? OR cv.provider LIKE ? ORDER BY cv.updated_at DESC LIMIT 100`).bind(responderId,term,term,term).all()
    : await db.prepare(`SELECT cv.id,cv.provider,cv.external_conversation_id,cv.channel_state,cv.updated_at,
        cv.inquiry_id,cv.event_id,cv.assigned_responder_id,cv.last_message_at,c.full_name,e.event_family,e.start_date,
        (SELECT COUNT(*) FROM conversation_messages cm WHERE cm.conversation_id=cv.id AND cm.sender_kind='customer' AND cm.sequence>COALESCE((SELECT cr.last_read_sequence FROM conversation_reads cr WHERE cr.conversation_id=cv.id AND cr.responder_id=?),0)) AS unread_count FROM conversations cv
        JOIN contacts c ON c.id=cv.contact_id LEFT JOIN events e ON e.id=cv.event_id ORDER BY cv.updated_at DESC LIMIT 100`).bind(responderId).all();
  return Response.json({ ok:true,conversations:result.results });
}

function toWindow(row: Record<string,unknown>): SchedulingWindow {
  return { id:String(row.id),startDate:text(row.start_date),endDate:text(row.end_date),startTime:text(row.start_time),endTime:text(row.end_time),blocksCapacity:Number(row.blocks_capacity)===1,schedulingState:text(row.scheduling_state) ?? undefined };
}
function text(value: unknown) { return typeof value === "string" ? value : null; }
function bounded(value: string|null,max: number) { return value?.trim().slice(0,max) || null; }
function clampInteger(value: string|null,min: number,max: number,fallback: number) { const parsed=Number(value);return Number.isInteger(parsed)&&parsed>=min&&parsed<=max?parsed:fallback; }
function positiveInteger(value: string|undefined,fallback: number) { const parsed=Number(value);return Number.isInteger(parsed)&&parsed>0?parsed:fallback; }
function invalid(message: string) { return Response.json({ ok:false,error:{ code:"validation_error",message } },{ status:422 }); }

async function currentUser(db:D1Database,actor:import("./auth").StaffIdentity,now:string){
  const presence=await db.prepare("SELECT available,heartbeat_at,expires_at FROM responder_presence WHERE responder_id=?").bind(actor.id).first<Record<string,unknown>>();
  const available=Number(presence?.available)===1&&typeof presence?.expires_at==="string"&&presence.expires_at>now;
  return Response.json({ok:true,user:{id:actor.id,displayName:actor.displayName,role:actor.role,verifiedEmail:actor.verifiedEmail,authMode:actor.authMode,availabilityState:available?"available":"unavailable"}});
}
