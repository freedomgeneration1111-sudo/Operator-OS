import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

beforeEach(async () => {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`).run();
  const applied = await env.DB.prepare("SELECT name FROM d1_migrations").all<{ name:string }>();
  const names = new Set(applied.results.map((row) => row.name));
  for (const migration of env.TEST_MIGRATIONS) {
    if (names.has(migration.name)) continue;
    await env.DB.batch([
      ...migration.queries.map((query) => env.DB.prepare(query)),
      env.DB.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(migration.name),
    ]);
  }
  const tables = ["conversation_notifications","conversation_resume_tokens","push_deliveries","push_subscriptions","conversation_activity","conversation_reads","conversation_messages","intake_submissions","consulting_details","activities","internal_notes","assignments","inquiry_services","conversations","responder_presence","inquiries","events","contacts","responders"];
  await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});
