const RESUME_TOKEN_PATTERN=/^[a-f0-9]{64}$/;

export function randomResumeToken(){const bytes=crypto.getRandomValues(new Uint8Array(32));return [...bytes].map((byte)=>byte.toString(16).padStart(2,"0")).join("");}
export async function hashResumeToken(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");}

export async function resolveConversationResumeToken(db:D1Database,token:string|null){
  if(!token||!RESUME_TOKEN_PATTERN.test(token))return null;const hash=await hashResumeToken(token);
  const legacy=await db.prepare("SELECT id FROM conversations WHERE public_resume_token_hash=?").bind(hash).first<{id:string}>();
  if(legacy)return{conversationId:legacy.id,tokenHash:hash,tokenId:null};
  const issued=await db.prepare("SELECT conversation_id,id FROM conversation_resume_tokens WHERE token_hash=? AND revoked_at IS NULL").bind(hash).first<{conversation_id:string;id:string}>();
  return issued?{conversationId:issued.conversation_id,tokenHash:hash,tokenId:issued.id}:null;
}

export async function markCustomerConversationResumed(db:D1Database,conversationId:string,tokenId:string|null){
  const now=new Date().toISOString();const statements=[
    db.prepare("UPDATE conversation_notifications SET cleared_at=? WHERE conversation_id=? AND cleared_at IS NULL").bind(now,conversationId),
  ];
  if(tokenId)statements.push(db.prepare("UPDATE conversation_resume_tokens SET last_used_at=? WHERE id=? AND conversation_id=?").bind(now,tokenId,conversationId));
  await db.batch(statements);
}
