import type { InquiryCreatedResponse, InquiryRequest } from "./contracts";
import type { SchedulingWindow } from "./scheduling";

type InquiryReplayRow = { id: string; event_id: string; created_at: string };

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

export async function createInquiry(db: D1Database, input: InquiryRequest, idempotencyKey: string, now: string): Promise<InquiryCreatedResponse> {
  const replay = await db.prepare("SELECT id,event_id,created_at FROM inquiries WHERE idempotency_key=?")
    .bind(idempotencyKey).first<InquiryReplayRow>();
  if (replay) return responseFor(replay.id, replay.event_id, replay.created_at, true);

  const normalizedEmail = input.email.toLowerCase();
  const existingContact = await db.prepare("SELECT id FROM contacts WHERE lower(email)=?")
    .bind(normalizedEmail).first<{ id: string }>();
  const contactId = existingContact?.id ?? id("con");
  const eventId = id("evt");
  const inquiryId = id("inq");
  const activityId = id("act");
  const statements: D1PreparedStatement[] = [];
  if (!existingContact) {
    statements.push(db.prepare(`INSERT INTO contacts
      (id,full_name,email,phone,preferred_contact,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(contactId,input.name,normalizedEmail,input.phone ?? null,input.contact,now,now));
  } else {
    statements.push(db.prepare(`UPDATE contacts SET full_name=?,phone=COALESCE(?,phone),preferred_contact=?,updated_at=? WHERE id=?`)
      .bind(input.name,input.phone ?? null,input.contact,now,contactId));
  }
  statements.push(
    db.prepare(`INSERT INTO events
      (id,event_family,start_date,end_date,start_time,end_time,venue_location,guest_count,blocks_capacity,scheduling_state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,0,'requested',?,?)`)
      .bind(eventId,input.eventType,input.date,input.endDate ?? input.date,input.startTime ?? null,input.endTime ?? null,input.location ?? null,input.guests ?? null,now,now),
    db.prepare(`INSERT INTO inquiries
      (id,contact_id,event_id,source_channel,workflow_state,budget_context,customer_note,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,?,'new',?,?,?,?,?)`)
      .bind(inquiryId,contactId,eventId,input.source ?? "website",input.budget ?? null,input.note ?? null,idempotencyKey,now,now),
    db.prepare(`INSERT INTO activities
      (id,inquiry_id,event_id,actor_kind,activity_type,metadata_json,created_at) VALUES (?,?,?,'customer','inquiry_created','{}',?)`)
      .bind(activityId,inquiryId,eventId,now),
    ...[...new Set(input.services)].map((service) => db.prepare("INSERT INTO inquiry_services (inquiry_id,service_name) VALUES (?,?)").bind(inquiryId,service)),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const racedReplay = await db.prepare("SELECT id,event_id,created_at FROM inquiries WHERE idempotency_key=?")
      .bind(idempotencyKey).first<InquiryReplayRow>();
    if (racedReplay) return responseFor(racedReplay.id, racedReplay.event_id, racedReplay.created_at, true);
    throw error;
  }
  return responseFor(inquiryId,eventId,now,false);
}

function responseFor(inquiryId: string,eventId: string,createdAt: string,idempotentReplay: boolean): InquiryCreatedResponse {
  return {
    ok: true, inquiryId, eventId, createdAt, idempotentReplay, status: "received_for_review",
    message: "Your inquiry was received for human review. This is not an availability confirmation.",
  };
}

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
    ? await db.prepare(`SELECT i.id,i.workflow_state,i.source_channel,i.created_at,c.full_name,c.email,e.event_family,e.start_date,e.blocks_capacity
        FROM inquiries i JOIN contacts c ON c.id=i.contact_id JOIN events e ON e.id=i.event_id
        WHERE c.full_name LIKE ? OR c.email LIKE ? OR i.id LIKE ? ORDER BY i.created_at DESC LIMIT 100`).bind(term,term,term).all()
    : await db.prepare(`SELECT i.id,i.workflow_state,i.source_channel,i.created_at,c.full_name,c.email,e.event_family,e.start_date,e.blocks_capacity
        FROM inquiries i JOIN contacts c ON c.id=i.contact_id JOIN events e ON e.id=i.event_id
        ORDER BY i.created_at DESC LIMIT 100`).all();
  return result.results;
}

export async function getInquiryDetail(db: D1Database, inquiryId: string) {
  const inquiry = await db.prepare(`SELECT i.*,c.full_name,c.email,c.phone,c.preferred_contact,
    e.event_family,e.start_date,e.end_date,e.start_time,e.end_time,e.venue_location,e.guest_count,e.blocks_capacity,e.scheduling_state
    FROM inquiries i JOIN contacts c ON c.id=i.contact_id JOIN events e ON e.id=i.event_id WHERE i.id=?`).bind(inquiryId).first();
  if (!inquiry) return null;
  const [services,assignments,notes,activities,conversations] = await db.batch([
    db.prepare("SELECT service_name FROM inquiry_services WHERE inquiry_id=? ORDER BY service_name").bind(inquiryId),
    db.prepare(`SELECT a.responder_id,r.display_label,a.assigned_at FROM assignments a JOIN responders r ON r.id=a.responder_id WHERE a.inquiry_id=?`).bind(inquiryId),
    db.prepare("SELECT n.id,n.author_responder_id,r.display_label AS author_label,n.body,n.created_at FROM internal_notes n LEFT JOIN responders r ON r.id=n.author_responder_id WHERE n.inquiry_id=? ORDER BY n.created_at DESC").bind(inquiryId),
    db.prepare("SELECT id,actor_kind,actor_id,activity_type,metadata_json,created_at FROM activities WHERE inquiry_id=? ORDER BY created_at DESC").bind(inquiryId),
    db.prepare("SELECT id,provider,external_conversation_id,channel_state,created_at,updated_at FROM conversations WHERE inquiry_id=? ORDER BY updated_at DESC").bind(inquiryId),
  ]);
  return { inquiry, services: services!.results, assignments: assignments!.results, notes: notes!.results, activities: activities!.results, conversations: conversations!.results };
}

export async function recordActivity(db: D1Database, inquiryId: string, eventId: string | null, type: string, actorId: string | null, metadata: object, now: string) {
  await db.prepare(`INSERT INTO activities (id,inquiry_id,event_id,actor_kind,actor_id,activity_type,metadata_json,created_at)
    VALUES (?,?,?,'responder',?,?,?,?)`).bind(id("act"),inquiryId,eventId,actorId,type,JSON.stringify(metadata),now).run();
}

export function newId(prefix: string) { return id(prefix); }
