import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read=(path)=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),"utf8"));
const inventory={
  focus:{api:read("deployments/focus-lab/api.staging.jsonc"),console:read("deployments/focus-lab/console.staging.jsonc")},
  moses:{api:read("deployments/moses-jorgensen/api.staging.jsonc"),console:read("deployments/moses-jorgensen/console.staging.jsonc")},
};
const db=(config)=>config.d1_databases[0];
const vars=(config)=>config.vars;
const rateIds=(config)=>new Set((config.ratelimits??[]).map((item)=>item.namespace_id));

test("each business is internally coherent",()=>{
  for(const [key,business] of Object.entries(inventory)){
    assert.equal(vars(business.api).BUSINESS_PROFILE,key);
    assert.equal(vars(business.console).BUSINESS_PROFILE,key);
    assert.equal(db(business.api).database_id,db(business.console).database_id);
    assert.equal(vars(business.api).ACCESS_AUD,vars(business.console).ACCESS_AUD);
    assert.equal(vars(business.api).VAPID_KEYSET_ID,vars(business.console).VAPID_KEYSET_ID);
    assert.equal(business.console.services[0].service,business.api.name);
    assert.equal(vars(business.console).PUBLIC_API_ENABLED,"false");
    assert.equal("durable_objects" in business.console,false,"console must not own Durable Objects");
    assert.ok(business.api.durable_objects?.bindings.length,"API must own Durable Objects");
    assert.match(business.console.main,/console\.ts$/);assert.match(business.api.main,/index\.ts$/);
    if(key==="focus")assert.ok(Object.values(business.console.exports).every((entry)=>entry.state==="deleted"),"legacy console DO exports must remain explicit tombstones");
  }
  assert.equal(vars(inventory.focus.api).PUBLIC_API_ENABLED,"true");
  assert.equal(vars(inventory.moses.api).PUBLIC_API_ENABLED,"false");
});

test("Focus and Moses resource/security identities never cross",()=>{
  const focus=inventory.focus;const moses=inventory.moses;
  assert.equal(new Set([focus.api.name,focus.console.name,moses.api.name,moses.console.name]).size,4);
  assert.notEqual(db(focus.api).database_id,db(moses.api).database_id);
  assert.notEqual(db(focus.api).database_name,db(moses.api).database_name);
  assert.notEqual(vars(focus.api).ACCESS_AUD,vars(moses.api).ACCESS_AUD);
  assert.notEqual(vars(focus.api).VAPID_KEYSET_ID,vars(moses.api).VAPID_KEYSET_ID);
  assert.notEqual(vars(focus.api).DEPLOYMENT_KEY,vars(moses.api).DEPLOYMENT_KEY);
  assert.notEqual(vars(focus.console).STAFF_HOSTNAME,vars(moses.console).STAFF_HOSTNAME);
  assert.ok(!JSON.stringify(moses).match(/focus[ -]?lab|focuslab/i));
  for(const id of rateIds(focus.api))assert.ok(!rateIds(moses.api).has(id),`cross-business rate-limit namespace ${id}`);
  assert.ok(!moses.console.services.some((service)=>service.service===focus.api.name));
  assert.ok(!focus.console.services.some((service)=>service.service===moses.api.name));
});

test("Moses provisioned deployment uses final isolated security identifiers",()=>{
  assert.match(db(inventory.moses.api).database_id,/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.doesNotMatch(db(inventory.moses.api).database_id,/^00000000-/);
  assert.match(vars(inventory.moses.api).ACCESS_AUD,/^[0-9a-f]{64}$/);
  assert.doesNotMatch(vars(inventory.moses.api).ACCESS_AUD,/_REQUIRED$/);
  assert.notEqual(vars(inventory.moses.api).ACCESS_AUD,vars(inventory.focus.api).ACCESS_AUD);
  assert.equal(vars(inventory.moses.api).PUBLIC_SITE_ORIGIN,"");
});
