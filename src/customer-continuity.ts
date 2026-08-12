import { createCustomerNotificationEmailProvider,CustomerEmailConfigurationError,CustomerEmailDeliveryError,type CustomerNotificationEmailProvider } from "./customer-email";
import { hashResumeToken,randomResumeToken } from "./resume-tokens";

export type ContinuityResult={status:"customer_active"|"email_pending"|"email_suppressed"|"email_accepted"|"email_failed";notificationId?:string};
type ReplyMessage={id:string;sequence:number};

export async function notifyCustomerOfAbsentReply(env:Env,conversationId:string,message:ReplyMessage,customerActive:boolean,provider?:CustomerNotificationEmailProvider):Promise<ContinuityResult>{
  if(customerActive)return{status:"customer_active"};
  const pending=await env.DB.prepare("SELECT id FROM conversation_notifications WHERE conversation_id=? AND cleared_at IS NULL ORDER BY attempted_at DESC LIMIT 1").bind(conversationId).first<{id:string}>();
  if(pending)return{status:"email_suppressed",notificationId:pending.id};
  const conversation=await env.DB.prepare(`SELECT c.email,c.full_name FROM conversations cv JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=?`).bind(conversationId).first<{email:string|null;full_name:string}>();
  if(!conversation?.email)return{status:"email_failed"};
  const now=new Date().toISOString();const notificationId=crypto.randomUUID();const tokenId=crypto.randomUUID();const rawToken=randomResumeToken();const tokenHash=await hashResumeToken(rawToken);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO conversation_resume_tokens (id,conversation_id,token_hash,purpose,created_at) VALUES (?,?,?,'email_continuity',?)").bind(tokenId,conversationId,tokenHash,now),
    env.DB.prepare(`INSERT INTO conversation_notifications (id,conversation_id,message_id,message_sequence,resume_token_id,provider,status,attempted_at)
      VALUES (?,?,?,?,?,'resend','pending',?)`).bind(notificationId,conversationId,message.id,message.sequence,tokenId,now),
  ]);
  let selectedProvider=provider;
  try{
    selectedProvider??=createCustomerNotificationEmailProvider(env);
    const origin=customerConversationOrigin(env);const resumeUrl=`${origin}/conversation/?resume=${encodeURIComponent(rawToken)}`;
    const result=await selectedProvider.sendConversationReplyNotification({
      to:conversation.email,customerFirstName:firstName(conversation.full_name),resumeUrl,idempotencyKey:`conversation-notification/${notificationId}`,
    });
    const completed=new Date().toISOString();await env.DB.prepare("UPDATE conversation_notifications SET status='accepted',provider=?,provider_message_id=?,completed_at=? WHERE id=?").bind(selectedProvider.name,result.providerMessageId,completed,notificationId).run();
    return{status:"email_accepted",notificationId};
  }catch(error){
    const failureCode=error instanceof CustomerEmailConfigurationError?"provider_not_configured":error instanceof CustomerEmailDeliveryError?error.category:"delivery_error";
    const completed=new Date().toISOString();await env.DB.batch([
      env.DB.prepare("UPDATE conversation_notifications SET status='failed',provider=?,failure_code=?,completed_at=? WHERE id=?").bind(selectedProvider?.name??"resend",failureCode,completed,notificationId),
      env.DB.prepare("UPDATE conversation_resume_tokens SET revoked_at=? WHERE id=?").bind(completed,tokenId),
    ]);
    console.warn(JSON.stringify({message:"customer continuity email failed",conversationId,notificationId,failureCode}));
    return{status:"email_failed",notificationId};
  }
}

function customerConversationOrigin(env:Env){const configured=env.CUSTOMER_CONVERSATION_ORIGIN||env.PUBLIC_SITE_ORIGIN?.split(",")[0];if(!configured)throw new CustomerEmailConfigurationError("Customer conversation origin is not configured");return configured.replace(/\/$/,"");}
function firstName(fullName:string){const value=fullName.trim().split(/\s+/)[0];return value||null;}
