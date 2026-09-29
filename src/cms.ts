import { z } from "zod";
import { requirePermission,type StaffIdentity } from "./auth";
import { CMS_SCHEMA_VERSION,cmsInitializationSchema,parseCmsDocument,type CmsDocument,type CmsDocumentKey } from "./cms-contracts";
import { handleCmsPublicationApi,publicationState,type PublicationConfig } from "./cms-publication";

const MAX_CMS_BODY_BYTES=256_000;
const saveSchema=z.object({expectedRevisionId:z.string().min(1).max(160),content:z.unknown()}).strict();
const restoreSchema=z.object({expectedRevisionId:z.string().min(1).max(160),revisionId:z.string().min(1).max(160)}).strict();
type RevisionRow={revision_id:string;document_key:CmsDocumentKey;sequence:number;schema_version:number;content_json:string;actor_id:string;actor_display_name:string;created_at:string;restored_from_revision_id:string|null};

export class CmsError extends Error{constructor(readonly status:number,readonly code:string,message:string,readonly fields?:Record<string,string[]>){super(message);}}
export type CmsInitializationActor=Pick<StaffIdentity,"id"|"displayName">;

export async function handleCmsApi(request:Request,db:D1Database,path:string,actor:StaffIdentity,publication:PublicationConfig={}):Promise<Response|null>{
  if(!path.startsWith("/v1/internal/cms"))return null;
  requirePermission(actor,"website:manage");
  if(path==="/v1/internal/cms"&&request.method==="GET")return cmsState(db,publication);
  if(path==="/v1/internal/cms/initialize"&&request.method==="POST")return initializeCmsFromRequest(request,db,actor);
  if(path==="/v1/internal/cms/snapshot"&&request.method==="GET")return exportSnapshot(db);
  const publicationResponse=await handleCmsPublicationApi(request,db,path,actor,publication);if(publicationResponse)return publicationResponse;
  const match=path.match(/^\/v1\/internal\/cms\/documents\/(pricing|faqs)(?:\/(revisions|restore))?$/);
  if(!match)return null;
  const key=match[1] as CmsDocumentKey;const action=match[2];
  if(!action&&request.method==="GET")return currentDocumentResponse(db,key);
  if(!action&&request.method==="PUT")return saveRequest(db,key,await body(request),actor);
  if(action==="revisions"&&request.method==="GET")return revisionHistory(db,key);
  if(action==="restore"&&request.method==="POST")return restoreRequest(db,key,await body(request),actor);
  return null;
}

async function cmsState(db:D1Database,config:PublicationConfig){
  const [pricing,faqs,publication]=await Promise.all([currentDocument(db,"pricing"),currentDocument(db,"faqs"),publicationState(db,Boolean(config.deployHookUrl&&config.runnerSecret))]);
  return response({ok:true,initialized:Boolean(pricing&&faqs),documents:{pricing,faqs},publication});
}
async function currentDocumentResponse(db:D1Database,key:CmsDocumentKey){const document=await currentDocument(db,key);if(!document)throw new CmsError(404,"cms_document_not_initialized",`${key} has not been initialized`);return response({ok:true,document});}
async function currentDocument(db:D1Database,key:CmsDocumentKey){
  const row=await db.prepare(`SELECT r.revision_id,r.document_key,r.sequence,r.schema_version,r.content_json,r.actor_id,r.actor_display_name,r.created_at,r.restored_from_revision_id
    FROM cms_documents d JOIN cms_revisions r ON r.revision_id=d.current_revision_id WHERE d.document_key=?`).bind(key).first<RevisionRow>();
  return row?presentRevision(row):null;
}
async function revisionById(db:D1Database,key:CmsDocumentKey,revisionId:string){
  const row=await db.prepare(`SELECT revision_id,document_key,sequence,schema_version,content_json,actor_id,actor_display_name,created_at,restored_from_revision_id
    FROM cms_revisions WHERE document_key=? AND revision_id=?`).bind(key,revisionId).first<RevisionRow>();
  return row?presentRevision(row):null;
}
async function revisionHistory(db:D1Database,key:CmsDocumentKey){
  const result=await db.prepare(`SELECT revision_id,document_key,sequence,schema_version,content_json,actor_id,actor_display_name,created_at,restored_from_revision_id
    FROM cms_revisions WHERE document_key=? ORDER BY sequence DESC LIMIT 100`).bind(key).all<RevisionRow>();
  return response({ok:true,documentKey:key,revisions:result.results.map(presentRevision)});
}
async function saveRequest(db:D1Database,key:CmsDocumentKey,value:unknown,actor:StaffIdentity){
  const parsed=saveSchema.safeParse(value);if(!parsed.success)throw validation(parsed.error);
  const content=parse(key,parsed.data.content);const document=await saveDocument(db,key,parsed.data.expectedRevisionId,content,actor,null);
  return response({ok:true,document});
}
async function restoreRequest(db:D1Database,key:CmsDocumentKey,value:unknown,actor:StaffIdentity){
  const parsed=restoreSchema.safeParse(value);if(!parsed.success)throw validation(parsed.error);
  const source=await db.prepare(`SELECT revision_id,document_key,sequence,schema_version,content_json,actor_id,actor_display_name,created_at,restored_from_revision_id
    FROM cms_revisions WHERE document_key=? AND revision_id=?`).bind(key,parsed.data.revisionId).first<RevisionRow>();
  if(!source)throw new CmsError(404,"cms_revision_not_found","The requested revision does not exist");
  const content=parse(key,JSON.parse(source.content_json) as unknown);
  const document=await saveDocument(db,key,parsed.data.expectedRevisionId,content,actor,source.revision_id);
  return response({ok:true,document});
}
async function saveDocument(db:D1Database,key:CmsDocumentKey,expectedRevisionId:string,content:CmsDocument,actor:StaffIdentity,restoredFrom:string|null){
  const revisionId=`${key}_${crypto.randomUUID()}`;const createdAt=new Date().toISOString();const contentJson=JSON.stringify(content);
  const [insert,update]=await db.batch([
    db.prepare(`INSERT INTO cms_revisions (revision_id,document_key,sequence,schema_version,content_json,actor_id,actor_display_name,created_at,restored_from_revision_id)
      SELECT ?,document_key,current_sequence+1,?,?,?, ?,?,? FROM cms_documents WHERE document_key=? AND current_revision_id=?`)
      .bind(revisionId,CMS_SCHEMA_VERSION,contentJson,actor.id,actor.displayName,createdAt,restoredFrom,key,expectedRevisionId),
    db.prepare(`UPDATE cms_documents SET current_revision_id=?,current_sequence=current_sequence+1,schema_version=?,updated_at=?
      WHERE document_key=? AND current_revision_id=? AND EXISTS (SELECT 1 FROM cms_revisions WHERE revision_id=?)`)
      .bind(revisionId,CMS_SCHEMA_VERSION,createdAt,key,expectedRevisionId,revisionId),
  ]);
  if(!insert||!update||Number(insert.meta.changes)!==1||Number(update.meta.changes)!==1){
    const current=await currentDocument(db,key);throw new CmsError(409,"cms_revision_conflict",`A newer ${key} draft was saved before this edit`,{currentRevisionId:current?[current.revisionId]:[]});
  }
  const saved=await revisionById(db,key,revisionId);if(!saved)throw new Error("CMS revision was saved without an immutable revision record");return saved;
}
export async function initializeCmsFromRequest(request:Request,db:D1Database,actor:CmsInitializationActor){return initializeCmsDocuments(db,await body(request),actor);}
export async function initializeCmsDocuments(db:D1Database,value:unknown,actor:CmsInitializationActor){
  const parsed=cmsInitializationSchema.safeParse(value);if(!parsed.success)throw validation(parsed.error);
  const initialized:CmsDocumentKey[]=[];
  for(const key of ["pricing","faqs"] as const){
    if(await currentDocument(db,key))continue;
    const content=parsed.data[key];const createdAt=new Date().toISOString();const digest=await sha256(stableStringify(content));const revisionId=`${key}_init_${digest.slice(0,24)}`;
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO cms_revisions (revision_id,document_key,sequence,schema_version,content_json,actor_id,actor_display_name,created_at,restored_from_revision_id)
        VALUES (?,?,1,?,?,?,?,?,NULL)`).bind(revisionId,key,CMS_SCHEMA_VERSION,JSON.stringify(content),actor.id,actor.displayName,createdAt),
      db.prepare(`INSERT OR IGNORE INTO cms_documents (document_key,schema_version,current_revision_id,current_sequence,created_at,updated_at) VALUES (?,?,?,1,?,?)`)
        .bind(key,CMS_SCHEMA_VERSION,revisionId,createdAt,createdAt),
    ]);
    initialized.push(key);
  }
  const [pricing,faqs]=await Promise.all([currentDocument(db,"pricing"),currentDocument(db,"faqs")]);
  return response({ok:true,initialized,documents:{pricing,faqs}},initialized.length?201:200);
}
async function exportSnapshot(db:D1Database){
  const [pricing,faqs]=await Promise.all([currentDocument(db,"pricing"),currentDocument(db,"faqs")]);
  if(!pricing||!faqs)throw new CmsError(409,"cms_not_initialized","Pricing and FAQ drafts must both be initialized before export");
  const core={schemaVersion:CMS_SCHEMA_VERSION,business:"focus" as const,exportedAt:new Date().toISOString(),documents:{
    pricing:{revisionId:pricing.revisionId,schemaVersion:pricing.schemaVersion,content:pricing.content},
    faqs:{revisionId:faqs.revisionId,schemaVersion:faqs.schemaVersion,content:faqs.content},
  }};
  const hash=await sha256(stableStringify(core));
  return response({...core,integrity:{algorithm:"SHA-256" as const,hash:`sha256-${hash}`}},200,{"Content-Disposition":`attachment; filename="focus-content-${pricing.revisionId}-${faqs.revisionId}.json"`});
}
function presentRevision(row:RevisionRow){return{revisionId:row.revision_id,documentKey:row.document_key,sequence:Number(row.sequence),schemaVersion:Number(row.schema_version),content:parse(row.document_key,JSON.parse(row.content_json) as unknown),actor:{id:row.actor_id,displayName:row.actor_display_name},createdAt:row.created_at,restoredFromRevisionId:row.restored_from_revision_id};}
function parse(key:CmsDocumentKey,value:unknown){try{return parseCmsDocument(key,value);}catch(error){if(error instanceof z.ZodError)throw validation(error);throw error;}}
async function body(request:Request){const length=Number(request.headers.get("Content-Length")??0);if(length>MAX_CMS_BODY_BYTES)throw new CmsError(413,"payload_too_large","CMS request body is too large");const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_CMS_BODY_BYTES)throw new CmsError(413,"payload_too_large","CMS request body is too large");try{return JSON.parse(text) as unknown;}catch{throw new CmsError(400,"invalid_json","Request body must be valid JSON");}}
function validation(error:z.ZodError){return new CmsError(422,"validation_error","CMS document validation failed",error.flatten().fieldErrors as Record<string,string[]>);}
function response(data:object,status=200,extra:HeadersInit={}){return Response.json(data,{status,headers:{"Cache-Control":"no-store",...extra}});}
export function stableStringify(value:unknown):string{if(Array.isArray(value))return`[${value.map(stableStringify).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>`${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;return JSON.stringify(value)??"null";}
async function sha256(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),(byte)=>byte.toString(16).padStart(2,"0")).join("");}
