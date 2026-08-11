-- SYNTHETIC DEVELOPMENT DATA ONLY. No real staff or customer information.
INSERT OR IGNORE INTO responders (id,display_label,active,created_at,updated_at) VALUES
('rsp_dev_a','Test Responder A',1,'2026-08-01T16:00:00.000Z','2026-08-01T16:00:00.000Z'),
('rsp_dev_b','Test Responder B',1,'2026-08-01T16:00:00.000Z','2026-08-01T16:00:00.000Z'),
('rsp_dev_c','Test Responder C',1,'2026-08-01T16:00:00.000Z','2026-08-01T16:00:00.000Z');
UPDATE responders SET verified_email="responder-a@example.test",role="responder" WHERE id="rsp_dev_a";
UPDATE responders SET verified_email="manager-b@example.test",role="manager" WHERE id="rsp_dev_b";
UPDATE responders SET verified_email="admin-c@example.test",role="admin" WHERE id="rsp_dev_c";

INSERT OR IGNORE INTO contacts (id,full_name,email,phone,preferred_contact,created_at,updated_at) VALUES
('con_demo_wedding','Synthetic Wedding Customer','wedding.customer@example.test',NULL,'email','2026-08-08T17:00:00.000Z','2026-08-08T17:00:00.000Z'),
('con_demo_south_asian','Synthetic Multi-Day Customer','multiday.customer@example.test',NULL,'email','2026-08-08T18:00:00.000Z','2026-08-08T18:00:00.000Z'),
('con_demo_party','Synthetic Party Customer','party.customer@example.test',NULL,'email','2026-08-09T15:00:00.000Z','2026-08-09T15:00:00.000Z'),
('con_demo_corporate','Synthetic Corporate Contact','corporate.contact@example.test',NULL,'email','2026-08-09T16:00:00.000Z','2026-08-09T16:00:00.000Z'),
('con_demo_overlap','Synthetic Overlap Customer','overlap.customer@example.test',NULL,'email','2026-08-10T15:00:00.000Z','2026-08-10T15:00:00.000Z'),
('con_demo_undated','Synthetic Undated Customer','undated.customer@example.test',NULL,'email','2026-08-10T16:00:00.000Z','2026-08-10T16:00:00.000Z');

INSERT OR IGNORE INTO events (id,event_family,start_date,end_date,start_time,end_time,venue_location,guest_count,blocks_capacity,scheduling_state,created_at,updated_at) VALUES
('evt_demo_wedding','Wedding','2027-06-10','2027-06-10','17:00','22:00','Synthetic Dallas Venue',180,1,'confirmed','2026-08-08T17:00:00.000Z','2026-08-10T17:00:00.000Z'),
('evt_demo_south_asian','South Asian Wedding','2027-07-18','2027-07-20',NULL,NULL,'Synthetic Irving Venue',320,0,'requested','2026-08-08T18:00:00.000Z','2026-08-08T18:00:00.000Z'),
('evt_demo_party','Party / Celebration','2027-06-10','2027-06-10',NULL,NULL,'Synthetic Fort Worth Loft',90,0,'requested','2026-08-09T15:00:00.000Z','2026-08-09T15:00:00.000Z'),
('evt_demo_corporate','Corporate / Community','2027-08-04','2027-08-04','09:00','15:00','Synthetic Plano Conference Center',240,1,'tentative','2026-08-09T16:00:00.000Z','2026-08-10T18:00:00.000Z'),
('evt_demo_overlap','Wedding','2027-06-10','2027-06-10','18:00','23:00','Synthetic Arlington Ballroom',140,1,'tentative','2026-08-10T15:00:00.000Z','2026-08-10T15:00:00.000Z'),
('evt_demo_undated','Corporate / Community',NULL,NULL,NULL,NULL,'Location pending',NULL,0,'requested','2026-08-10T16:00:00.000Z','2026-08-10T16:00:00.000Z');

INSERT OR IGNORE INTO inquiries (id,contact_id,event_id,source_channel,workflow_state,budget_context,customer_note,idempotency_key,created_at,updated_at) VALUES
('inq_demo_wedding','con_demo_wedding','evt_demo_wedding','development_seed','reviewing','Development-only range','Synthetic inquiry for testing an assigned, capacity-blocking wedding.','seed-wedding-0001','2026-08-08T17:00:00.000Z','2026-08-10T17:00:00.000Z'),
('inq_demo_south_asian','con_demo_south_asian','evt_demo_south_asian','development_seed','new',NULL,'Synthetic multi-day inquiry with incomplete timing for human review.','seed-multiday-0001','2026-08-08T18:00:00.000Z','2026-08-08T18:00:00.000Z'),
('inq_demo_party','con_demo_party','evt_demo_party','development_seed','new',NULL,'Synthetic party opportunity on a date with another blocking event.','seed-party-0001','2026-08-09T15:00:00.000Z','2026-08-09T15:00:00.000Z'),
('inq_demo_corporate','con_demo_corporate','evt_demo_corporate','development_seed','qualified',NULL,'Synthetic corporate opportunity assigned for testing.','seed-corporate-0001','2026-08-09T16:00:00.000Z','2026-08-10T18:00:00.000Z'),
('inq_demo_overlap','con_demo_overlap','evt_demo_overlap','development_seed','reviewing',NULL,'Synthetic capacity conflict for schedule testing.','seed-overlap-0001','2026-08-10T15:00:00.000Z','2026-08-10T15:00:00.000Z'),
('inq_demo_undated','con_demo_undated','evt_demo_undated','development_seed','new',NULL,'Synthetic opportunity with no confirmed date.','seed-undated-0001','2026-08-10T16:00:00.000Z','2026-08-10T16:00:00.000Z');

INSERT OR IGNORE INTO inquiry_services (inquiry_id,service_name) VALUES
('inq_demo_wedding','Photo'),('inq_demo_wedding','Video'),('inq_demo_wedding','DJ / MC'),
('inq_demo_south_asian','Photo'),('inq_demo_south_asian','Video'),('inq_demo_south_asian','Lighting / Production'),
('inq_demo_party','DJ / MC'),('inq_demo_party','Photo Booth / 360'),
('inq_demo_corporate','Video'),('inq_demo_corporate','Lighting / Production'),
('inq_demo_overlap','Photo'),('inq_demo_overlap','Video'),('inq_demo_undated','Video');

INSERT OR IGNORE INTO assignments (inquiry_id,responder_id,assigned_at,assigned_by) VALUES
('inq_demo_wedding','rsp_dev_a','2026-08-10T17:00:00.000Z','rsp_dev_a'),
('inq_demo_corporate','rsp_dev_b','2026-08-10T18:00:00.000Z','rsp_dev_a');

INSERT OR IGNORE INTO internal_notes (id,inquiry_id,author_responder_id,body,created_at) VALUES
('note_demo_wedding','inq_demo_wedding','rsp_dev_a','Synthetic internal note: review the overlapping event before discussing date options.','2026-08-10T17:05:00.000Z'),
('note_demo_corporate','inq_demo_corporate','rsp_dev_b','Synthetic internal note: venue details are intentionally fictional development data.','2026-08-10T18:05:00.000Z');

INSERT OR IGNORE INTO conversations (id,contact_id,inquiry_id,event_id,provider,external_conversation_id,channel_state,created_at,updated_at) VALUES
('cv_demo_wedding','con_demo_wedding','inq_demo_wedding','evt_demo_wedding','development-shared-inbox','synthetic-thread-001','open','2026-08-10T17:10:00.000Z','2026-08-10T17:10:00.000Z'),
('cv_demo_corporate','con_demo_corporate','inq_demo_corporate','evt_demo_corporate','development-shared-inbox',NULL,'pending','2026-08-10T18:10:00.000Z','2026-08-10T18:10:00.000Z');

INSERT OR IGNORE INTO activities (id,inquiry_id,event_id,actor_kind,actor_id,activity_type,metadata_json,created_at) VALUES
('act_demo_wedding_created','inq_demo_wedding','evt_demo_wedding','customer',NULL,'inquiry_created','{}','2026-08-08T17:00:00.000Z'),
('act_demo_wedding_assigned','inq_demo_wedding','evt_demo_wedding','responder','rsp_dev_a','responder_assigned','{"responderId":"rsp_dev_a"}','2026-08-10T17:00:00.000Z'),
('act_demo_wedding_note','inq_demo_wedding','evt_demo_wedding','responder','rsp_dev_a','internal_note_added','{"noteId":"note_demo_wedding"}','2026-08-10T17:05:00.000Z'),
('act_demo_multiday_created','inq_demo_south_asian','evt_demo_south_asian','customer',NULL,'inquiry_created','{}','2026-08-08T18:00:00.000Z'),
('act_demo_party_created','inq_demo_party','evt_demo_party','customer',NULL,'inquiry_created','{}','2026-08-09T15:00:00.000Z'),
('act_demo_corporate_created','inq_demo_corporate','evt_demo_corporate','customer',NULL,'inquiry_created','{}','2026-08-09T16:00:00.000Z'),
('act_demo_overlap_created','inq_demo_overlap','evt_demo_overlap','customer',NULL,'inquiry_created','{}','2026-08-10T15:00:00.000Z'),
('act_demo_undated_created','inq_demo_undated','evt_demo_undated','customer',NULL,'inquiry_created','{}','2026-08-10T16:00:00.000Z');
