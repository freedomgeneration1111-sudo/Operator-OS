import { env } from "cloudflare:workers";
import { createLocalJWKSet,exportJWK,generateKeyPair,SignJWT,type JSONWebKeySet } from "jose";
import { beforeAll,beforeEach,describe,expect,it } from "vitest";
import { authenticateStaff,can,resolveStaffIdentity,verifyAccessAssertion,type StaffIdentity } from "../src/auth";

const issuer="https://focus-lab-test.cloudflareaccess.com";const audience="staff-app-audience";
let privateKey:CryptoKey;let keys:ReturnType<typeof createLocalJWKSet>;
beforeAll(async()=>{const pair=await generateKeyPair("RS256",{extractable:true});privateKey=pair.privateKey;const publicJwk=await exportJWK(pair.publicKey);publicJwk.kid="test-key";publicJwk.alg="RS256";keys=createLocalJWKSet({keys:[publicJwk]} as JSONWebKeySet);});
async function token(overrides:{iss?:string;aud?:string;exp?:number}={},signingKey:CryptoKey=privateKey){const now=Math.floor(Date.now()/1000);return new SignJWT({email:"authorized@example.test"}).setProtectedHeader({alg:"RS256",kid:"test-key"}).setSubject("access-subject-1").setIssuer(overrides.iss??issuer).setAudience(overrides.aud??audience).setIssuedAt(now).setExpirationTime(overrides.exp??now+300).sign(signingKey);}

beforeEach(async()=>{const now=new Date().toISOString();await env.DB.prepare("INSERT INTO responders (id,display_label,active,created_at,updated_at,access_subject,verified_email,role) VALUES (?,?,?,?,?,?,?,?)").bind("rsp_access","Authorized Staff",1,now,now,"access-subject-1","authorized@example.test","manager").run();});

describe("Cloudflare Access JWT validation",()=>{
  it("accepts a correctly signed token",async()=>expect(await verifyAccessAssertion(await token(),{issuer,audience},keys)).toMatchObject({sub:"access-subject-1",email:"authorized@example.test"}));
  it("rejects invalid signatures",async()=>{const other=await generateKeyPair("RS256");await expect(verifyAccessAssertion(await token({},other.privateKey),{issuer,audience},keys)).rejects.toMatchObject({code:"invalid_access_assertion"});});
  it("rejects wrong issuer",async()=>await expect(verifyAccessAssertion(await token({iss:"https://wrong.cloudflareaccess.com"}),{issuer,audience},keys)).rejects.toMatchObject({code:"invalid_access_assertion"}));
  it("rejects wrong audience",async()=>await expect(verifyAccessAssertion(await token({aud:"wrong-audience"}),{issuer,audience},keys)).rejects.toMatchObject({code:"invalid_access_assertion"}));
  it("rejects expired tokens",async()=>await expect(verifyAccessAssertion(await token({exp:Math.floor(Date.now()/1000)-10}),{issuer,audience},keys)).rejects.toMatchObject({code:"invalid_access_assertion"}));
  it("rejects malformed tokens",async()=>await expect(verifyAccessAssertion("not-a-jwt",{issuer,audience},keys)).rejects.toMatchObject({code:"invalid_access_assertion"}));
});

describe("D1 staff authorization",()=>{
  it("maps known active Access identity",async()=>expect(await resolveStaffIdentity(env.DB,{sub:"access-subject-1",email:"authorized@example.test"})).toMatchObject({id:"rsp_access",role:"manager",authMode:"access"}));
  it("rejects unknown identity",async()=>await expect(resolveStaffIdentity(env.DB,{sub:"missing",email:"missing@example.test"})).rejects.toMatchObject({code:"staff_not_authorized"}));
  it("rejects inactive staff",async()=>{await env.DB.prepare("UPDATE responders SET active=0 WHERE id='rsp_access'").run();await expect(resolveStaffIdentity(env.DB,{sub:"access-subject-1",email:"authorized@example.test"})).rejects.toMatchObject({code:"staff_inactive"});});
  it("links a pre-authorized email mapping to the stable Access subject",async()=>{await env.DB.prepare("UPDATE responders SET access_subject=NULL WHERE id='rsp_access'").run();await resolveStaffIdentity(env.DB,{sub:"new-stable-subject",email:"AUTHORIZED@example.test"});expect(await env.DB.prepare("SELECT access_subject FROM responders WHERE id='rsp_access'").first<string>("access_subject")).toBe("new-stable-subject");});
  it("implements the explicit permission hierarchy",()=>{const identity=(role:StaffIdentity["role"])=>({id:"r",displayName:"R",role,verifiedEmail:null,accessSubject:null,authMode:"development" as const});expect(can(identity("responder"),"assignment:self")).toBe(true);expect(can(identity("responder"),"capacity:manage")).toBe(false);expect(can(identity("manager"),"capacity:manage")).toBe(true);expect(can(identity("admin"),"staff:admin")).toBe(true);});
});

describe("development and production boundary",()=>{
  it("accepts explicit development auth locally",async()=>{const request=new Request("https://test/v1/internal/me",{headers:{Authorization:"Bearer development-test-token-00000000","X-Development-Responder-Id":"rsp_access"}});await expect(authenticateStaff(request,env)).resolves.toMatchObject({id:"rsp_access",authMode:"development"});});
  it("fails closed when production Access configuration is absent",async()=>{const production={...env,ENVIRONMENT:"production",STAFF_AUTH_MODE:"access",ACCESS_TEAM_DOMAIN:undefined,ACCESS_AUD:undefined};await expect(authenticateStaff(new Request("https://test"),production)).rejects.toMatchObject({code:"auth_configuration_error",status:503});});
  it("does not accept the legacy bearer token in production",async()=>{const production={...env,ENVIRONMENT:"production",STAFF_AUTH_MODE:"access",ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:audience};const request=new Request("https://test",{headers:{Authorization:"Bearer development-test-token-00000000"}});await expect(authenticateStaff(request,production)).rejects.toMatchObject({code:"authentication_required"});});
});
