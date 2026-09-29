import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

beforeEach(async()=>{
  await env.CMS_DB.prepare(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`).run();
  const applied=await env.CMS_DB.prepare("SELECT name FROM d1_migrations").all<{name:string}>();
  const names=new Set(applied.results.map((row)=>row.name));
  for(const migration of env.TEST_CMS_MIGRATIONS){
    if(names.has(migration.name))continue;
    await env.CMS_DB.batch([
      ...migration.queries.map((query)=>env.CMS_DB.prepare(query)),
      env.CMS_DB.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(migration.name),
    ]);
  }
  await env.CMS_DB.batch([
    env.CMS_DB.prepare("UPDATE cms_publication_state SET current_live_release_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE singleton=1"),
    env.CMS_DB.prepare("DELETE FROM cms_releases"),
    env.CMS_DB.prepare("DELETE FROM cms_documents"),
    env.CMS_DB.prepare("DELETE FROM cms_revisions"),
  ]);
});
