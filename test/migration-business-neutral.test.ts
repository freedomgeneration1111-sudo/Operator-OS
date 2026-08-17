import { env } from "cloudflare:workers";
import { describe,expect,it } from "vitest";

type Migration={name:string;queries:string[]};
const bindings=env as Env&{MIGRATION_DB:D1Database;TEST_MIGRATIONS:Migration[]};

describe("business-neutral inquiry migration",()=>{
  it("preserves a populated migration-5 database and permits an eventless inquiry",async()=>{
    const db=bindings.MIGRATION_DB;
    const migrations=bindings.TEST_MIGRATIONS;
    for(const migration of migrations.slice(0,5))await db.batch(migration.queries.map((query)=>db.prepare(query)));
    const now="2026-08-17T12:00:00.000Z";
    await db.batch([
      db.prepare("INSERT INTO responders (id,display_label,active,created_at,updated_at) VALUES (?,?,?,?,?)").bind("rsp_migration","Migration Responder",1,now,now),
      db.prepare("INSERT INTO contacts VALUES (?,?,?,?,?,?,?)").bind("con_migration","Migration Contact","migration@example.test",null,"email",now,now),
      db.prepare("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind("evt_migration","Wedding","2027-01-02","2027-01-02",null,null,"Migration Venue",80,1,"confirmed",now,now),
      db.prepare("INSERT INTO inquiries VALUES (?,?,?,?,?,?,?,?,?,?)").bind("inq_migration","con_migration","evt_migration","migration_fixture","reviewing","fixture budget","fixture note","migration-idempotency",now,now),
      db.prepare("INSERT INTO inquiry_services VALUES (?,?)").bind("inq_migration","Photo"),
      db.prepare("INSERT INTO assignments VALUES (?,?,?,?)").bind("inq_migration","rsp_migration",now,"rsp_migration"),
      db.prepare("INSERT INTO internal_notes VALUES (?,?,?,?,?)").bind("note_migration","inq_migration","rsp_migration","Preserved note",now),
      db.prepare("INSERT INTO conversations (id,contact_id,inquiry_id,event_id,provider,channel_state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind("cv_migration","con_migration","inq_migration","evt_migration","native_web","open",now,now),
      db.prepare("INSERT INTO activities (id,inquiry_id,event_id,actor_kind,activity_type,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)").bind("act_migration","inq_migration","evt_migration","customer","inquiry_created","{}",now),
    ]);

    await db.batch(migrations[5]!.queries.map((query)=>db.prepare(query)));

    const inquiry=await db.prepare("SELECT * FROM inquiries WHERE id='inq_migration'").first<Record<string,unknown>>();
    expect(inquiry).toMatchObject({contact_id:"con_migration",event_id:"evt_migration",idempotency_key:"migration-idempotency",created_at:now,updated_at:now});
    for(const [table,idColumn,id] of [
      ["contacts","id","con_migration"],["events","id","evt_migration"],["inquiry_services","inquiry_id","inq_migration"],
      ["assignments","inquiry_id","inq_migration"],["internal_notes","id","note_migration"],["conversations","id","cv_migration"],["activities","id","act_migration"],
    ] as const){
      expect(await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${idColumn}=?`).bind(id).first<number>("count")).toBe(1);
    }
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    await db.prepare("INSERT INTO contacts VALUES (?,?,?,?,?,?,?)").bind("con_eventless","Eventless Contact","eventless@example.test",null,"email",now,now).run();
    await db.prepare("INSERT INTO inquiries VALUES (?,?,?,?,?,?,?,?,?,?)").bind("inq_eventless","con_eventless",null,"website","new",null,null,"eventless-idempotency",now,now).run();
    expect(await db.prepare("SELECT event_id FROM inquiries WHERE id='inq_eventless'").first<null>("event_id")).toBeNull();
  });
});
