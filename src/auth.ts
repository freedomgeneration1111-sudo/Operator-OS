import { createRemoteJWKSet,jwtVerify,type JWTPayload,type JWTVerifyGetKey } from "jose";
import { resolveClientBusinessProfile } from "../business-profiles.mts";

export type StaffRole="admin"|"manager"|"responder";
export type StaffAuthEnv={DB:D1Database;ENVIRONMENT?:string;STAFF_AUTH_MODE?:string;ACCESS_TEAM_DOMAIN?:string;ACCESS_AUD?:string;INTERNAL_API_TOKEN?:string;BUSINESS_PROFILE?:string};
export type StaffIdentity={
  id:string;displayName:string;role:StaffRole;verifiedEmail:string|null;accessSubject:string|null;authMode:"development"|"access";
};
export type Permission="crm:read"|"notes:create"|"workflow:update"|"assignment:self"|"assignment:manage"|"capacity:manage"|"presence:self"|"staff:admin";

const permissions:Record<StaffRole,ReadonlySet<Permission>>={
  responder:new Set(["crm:read","notes:create","workflow:update","assignment:self","presence:self"]),
  manager:new Set(["crm:read","notes:create","workflow:update","assignment:self","assignment:manage","capacity:manage","presence:self"]),
  admin:new Set(["crm:read","notes:create","workflow:update","assignment:self","assignment:manage","capacity:manage","presence:self","staff:admin"]),
};

export class AuthenticationError extends Error{
  constructor(readonly code:string,message:string,readonly status=401){super(message);}
}
export function can(identity:StaffIdentity,permission:Permission){return permissions[identity.role].has(permission);}
export function requirePermission(identity:StaffIdentity,permission:Permission){
  if(!can(identity,permission))throw new AuthenticationError("forbidden","Your staff role does not permit this action",403);
}

export async function authenticateStaff(request:Request,env:StaffAuthEnv):Promise<StaffIdentity>{
  const stage=env.ENVIRONMENT??"production";
  const mode:string=env.STAFF_AUTH_MODE??"access";
  if(stage==="development"&&mode==="development")return authenticateDevelopment(request,env);
  if(mode!=="access")throw new AuthenticationError("auth_configuration_error","Staff authentication is not configured",503);
  if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)throw new AuthenticationError("auth_configuration_error","Cloudflare Access configuration is incomplete",503);
  const assertion=request.headers.get("Cf-Access-Jwt-Assertion");
  if(!assertion)throw new AuthenticationError("authentication_required","Cloudflare Access authentication is required");
  const issuer=normalizeIssuer(env.ACCESS_TEAM_DOMAIN);
  const payload=await verifyAccessAssertion(assertion,{issuer,audience:env.ACCESS_AUD});
  return resolveStaffIdentity(env.DB,payload,resolveClientBusinessProfile(env.BUSINESS_PROFILE).shortName);
}

export async function verifyAccessAssertion(token:string,config:{issuer:string;audience:string},key?:JWTVerifyGetKey):Promise<JWTPayload>{
  try{
    const resolver=key??createRemoteJWKSet(new URL(`${normalizeIssuer(config.issuer)}/cdn-cgi/access/certs`));
    const {payload}=await jwtVerify(token,resolver,{issuer:normalizeIssuer(config.issuer),audience:config.audience,algorithms:["RS256"]});
    if(typeof payload.sub!=="string"||!payload.sub)throw new AuthenticationError("invalid_access_identity","Access assertion has no stable subject");
    if(typeof payload.email!=="string"||!payload.email)throw new AuthenticationError("invalid_access_identity","Access assertion has no verified email");
    return payload;
  }catch(error){
    if(error instanceof AuthenticationError)throw error;
    throw new AuthenticationError("invalid_access_assertion","Cloudflare Access assertion is invalid or expired");
  }
}

export async function resolveStaffIdentity(db:D1Database,payload:JWTPayload,businessName="this business"):Promise<StaffIdentity>{
  const subject=String(payload.sub);const email=String(payload.email).trim().toLowerCase();
  const row=await db.prepare(`SELECT id,display_label,active,role,access_subject,verified_email FROM responders
    WHERE access_subject=? OR (access_subject IS NULL AND lower(verified_email)=?) ORDER BY CASE WHEN access_subject=? THEN 0 ELSE 1 END LIMIT 1`)
    .bind(subject,email,subject).first<Record<string,unknown>>();
  if(!row)throw new AuthenticationError("staff_not_authorized",`This Access identity is not authorized for ${businessName} operations`,403);
  if(Number(row.active)!==1)throw new AuthenticationError("staff_inactive","This staff identity is inactive",403);
  if(!isRole(row.role))throw new AuthenticationError("staff_role_invalid","Staff authorization is misconfigured",403);
  if(!row.access_subject){await db.prepare("UPDATE responders SET access_subject=?,updated_at=? WHERE id=? AND access_subject IS NULL").bind(subject,new Date().toISOString(),String(row.id)).run();}
  return {id:String(row.id),displayName:String(row.display_label),role:row.role,verifiedEmail:email,accessSubject:subject,authMode:"access"};
}

async function authenticateDevelopment(request:Request,env:StaffAuthEnv):Promise<StaffIdentity>{
  if(!await secureTokenMatches(bearerToken(request),env.INTERNAL_API_TOKEN))throw new AuthenticationError("authentication_required","Development authentication is required");
  const responderId=request.headers.get("X-Development-Responder-Id");
  const row=responderId
    ? await env.DB.prepare("SELECT id,display_label,active,role,verified_email,access_subject FROM responders WHERE id=?").bind(responderId).first<Record<string,unknown>>()
    : await env.DB.prepare("SELECT id,display_label,active,role,verified_email,access_subject FROM responders WHERE active=1 ORDER BY display_label LIMIT 1").first<Record<string,unknown>>();
  if(!row)throw new AuthenticationError("staff_not_authorized","Development responder not found",403);
  if(Number(row.active)!==1)throw new AuthenticationError("staff_inactive","Development responder is inactive",403);
  if(!isRole(row.role))throw new AuthenticationError("staff_role_invalid","Staff authorization is misconfigured",403);
  return {id:String(row.id),displayName:String(row.display_label),role:row.role,verifiedEmail:text(row.verified_email),accessSubject:text(row.access_subject),authMode:"development"};
}

function normalizeIssuer(value:string){return value.replace(/\/$/,"");}
function isRole(value:unknown):value is StaffRole{return value==="admin"||value==="manager"||value==="responder";}
function text(value:unknown){return typeof value==="string"?value:null;}
export async function secureTokenMatches(provided:string|null,expected:string|undefined):Promise<boolean>{
  if(!provided||!expected)return false;const encoder=new TextEncoder();const [a,b]=await Promise.all([crypto.subtle.digest("SHA-256",encoder.encode(provided)),crypto.subtle.digest("SHA-256",encoder.encode(expected))]);const left=new Uint8Array(a);const right=new Uint8Array(b);let difference=0;for(let i=0;i<left.length;i+=1)difference|=left[i]!^right[i]!;return difference===0;
}
export function bearerToken(request:Request){const value=request.headers.get("Authorization");return value?.startsWith("Bearer ")?value.slice(7):null;}
