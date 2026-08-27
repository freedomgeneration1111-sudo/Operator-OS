import type { SchedulingWindow } from "./scheduling";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

export async function listBlockingWindows(db: D1Database, startDate: string, endDate: string): Promise<SchedulingWindow[]> {
  const result = await db.prepare(`SELECT id,start_date,end_date,start_time,end_time,blocks_capacity,scheduling_state
    FROM events WHERE blocks_capacity=1 AND scheduling_state NOT IN ('cancelled','declined')
    AND start_date IS NOT NULL AND COALESCE(end_date,start_date)>=? AND start_date<=?`)
    .bind(startDate,endDate).all<Record<string,unknown>>();
  return result.results.map((row) => ({
    id: String(row.id), startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null, startTime: row.start_time ? String(row.start_time) : null,
    endTime: row.end_time ? String(row.end_time) : null, blocksCapacity: Number(row.blocks_capacity) === 1,
    schedulingState: row.scheduling_state ? String(row.scheduling_state) : undefined,
  }));
}

export async function listInquiries(db: D1Database, query: string | null) {
  const term = query?.trim() ? `%${query.trim()}%` : null;
  const result = term
    ? await db.prepare(`SELECT i.id,i.event_id,i.workflow_state,i.source_channel,i.created_at,c.full_name,c.email,
        e.event_family,e.start_date,e.blocks_capacity,cd.organization,cd.offer_service_area,cd.situation_problem,cd.desired_outcome,cd.referral_source
        FROM inquiries i JOIN contacts c ON c.id=i.contact_id LEFT JOIN events e ON e.id=i.event_id
        LEFT JOIN consulting_details cd ON cd.inquiry_id=i.id
        WHERE c.full_name LIKE ? OR c.email LIKE ? OR i.id LIKE ? OR cd.organization LIKE ? OR cd.offer_service_area LIKE ?
          OR cd.situation_problem LIKE ? OR cd.desired_outcome LIKE ? OR cd.referral_source LIKE ?
        ORDER BY i.created_at DESC LIMIT 100`).bind(term,term,term,term,term,term,term,term).all()
    : await db.prepare(`SELECT i.id,i.event_id,i.workflow_state,i.source_channel,i.created_at,c.full_name,c.email,
        e.event_family,e.start_date,e.blocks_capacity,cd.organization,cd.offer_service_area,cd.situation_problem,cd.desired_outcome,cd.referral_source
        FROM inquiries i JOIN contacts c ON c.id=i.contact_id LEFT JOIN events e ON e.id=i.event_id
        LEFT JOIN consulting_details cd ON cd.inquiry_id=i.id
        ORDER BY i.created_at DESC LIMIT 100`).all();
  return result.results;
}

export async function getInquiryDetail(db: D1Database, inquiryId: string) {
  const inquiry = await db.prepare(`SELECT i.*,c.full_name,c.email,c.phone,c.preferred_contact,
    e.event_family,e.start_date,e.end_date,e.start_time,e.end_time,e.venue_location,e.guest_count,e.blocks_capacity,e.scheduling_state
    FROM inquiries i JOIN contacts c ON c.id=i.contact_id LEFT JOIN events e ON e.id=i.event_id WHERE i.id=?`).bind(inquiryId).first();
  if (!inquiry) return null;
  const [services,consulting,intakeSubmissions,assignments,notes,activities,conversations] = await db.batch([
    db.prepare("SELECT service_name FROM inquiry_services WHERE inquiry_id=? ORDER BY service_name").bind(inquiryId),
    db.prepare(`SELECT organization,offer_service_area,situation_problem,desired_outcome,timeline,budget,country_region,referral_source,created_at,updated_at
      FROM consulting_details WHERE inquiry_id=?`).bind(inquiryId),
    db.prepare(`SELECT id,form_schema_key,schema_version,origin,source_channel,referral,landing_page,referrer,
      utm_source,utm_medium,utm_campaign,utm_term,utm_content,captured_at,received_at,availability_checked
      FROM intake_submissions WHERE inquiry_id=? ORDER BY received_at DESC`).bind(inquiryId),
    db.prepare(`SELECT a.responder_id,r.display_label,a.assigned_at FROM assignments a JOIN responders r ON r.id=a.responder_id WHERE a.inquiry_id=?`).bind(inquiryId),
    db.prepare("SELECT n.id,n.author_responder_id,r.display_label AS author_label,n.body,n.created_at FROM internal_notes n LEFT JOIN responders r ON r.id=n.author_responder_id WHERE n.inquiry_id=? ORDER BY n.created_at DESC").bind(inquiryId),
    db.prepare("SELECT id,actor_kind,actor_id,activity_type,metadata_json,created_at FROM activities WHERE inquiry_id=? ORDER BY created_at DESC").bind(inquiryId),
    db.prepare("SELECT id,provider,external_conversation_id,channel_state,created_at,updated_at FROM conversations WHERE inquiry_id=? ORDER BY updated_at DESC").bind(inquiryId),
  ]);
  return {
    inquiry,
    event:inquiry.event_id?{
      id:inquiry.event_id,event_family:inquiry.event_family,start_date:inquiry.start_date,end_date:inquiry.end_date,
      start_time:inquiry.start_time,end_time:inquiry.end_time,venue_location:inquiry.venue_location,
      guest_count:inquiry.guest_count,blocks_capacity:inquiry.blocks_capacity,scheduling_state:inquiry.scheduling_state,
    }:null,
    consulting:consulting!.results[0]??null,
    intakeSubmissions:intakeSubmissions!.results,
    services:services!.results,assignments:assignments!.results,notes:notes!.results,
    activities:activities!.results,conversations:conversations!.results,
  };
}

export async function recordActivity(db: D1Database, inquiryId: string, eventId: string | null, type: string, actorId: string | null, metadata: object, now: string) {
  await db.prepare(`INSERT INTO activities (id,inquiry_id,event_id,actor_kind,actor_id,activity_type,metadata_json,created_at)
    VALUES (?,?,?,'responder',?,?,?,?)`).bind(id("act"),inquiryId,eventId,actorId,type,JSON.stringify(metadata),now).run();
}

export function newId(prefix: string) { return id(prefix); }
