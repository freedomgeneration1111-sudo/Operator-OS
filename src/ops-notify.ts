import { resolveClientBusinessProfile } from "../business-profiles.mts";

export type OpsNotificationEvent={conversationId:string;sequence:number;senderKind:string};
export type ConsultingInquiryNotificationEvent={inquiryId:string};
type ConversationContactRow={reply_email:number;reply_sms:number;reply_call:number;full_name:string;email:string|null;phone:string|null;body:string};
type ConsultingInquiryRow={
  full_name:string;email:string|null;phone:string|null;organization:string|null;situation_problem:string|null;
  source_channel:string;landing_page:string|null;utm_source:string|null;utm_medium:string|null;utm_campaign:string|null;
};

export async function dispatchOpsNotificationEmail(env:Env,event:OpsNotificationEvent,fetcher:typeof fetch=fetch):Promise<void>{
  if(event.senderKind!=="customer")return;
  const profile=resolveClientBusinessProfile(env.BUSINESS_PROFILE);
  if(!profile.capabilities.opsNotifyEmail)return;
  if(!env.RESEND_API_KEY||!env.CUSTOMER_EMAIL_FROM||!env.OPS_NOTIFY_EMAIL){
    console.warn(JSON.stringify({message:"ops notification skipped: not configured",conversationId:event.conversationId}));
    return;
  }
  const row=await env.DB.prepare(`SELECT cv.reply_email,cv.reply_sms,cv.reply_call,c.full_name,c.email,c.phone,m.body
    FROM conversations cv JOIN contacts c ON c.id=cv.contact_id JOIN conversation_messages m ON m.conversation_id=cv.id AND m.sequence=?
    WHERE cv.id=?`).bind(event.sequence,event.conversationId).first<ConversationContactRow>();
  if(!row)return;
  const preferences=[row.reply_email?"Email":null,row.reply_sms?"Text":null,row.reply_call?"Call":null].filter(Boolean).join(", ")||"None selected";
  const deepLink=env.STAFF_CONSOLE_ORIGIN?`${env.STAFF_CONSOLE_ORIGIN.replace(/\/$/,"")}/#/chat?conversation=${encodeURIComponent(event.conversationId)}`:null;
  const text=`New message from ${row.full_name}\n\n${row.body}\n\nEmail: ${row.email??"Not supplied"}\nPhone: ${row.phone??"Not supplied"}\nReply preferences: ${preferences}${deepLink?`\n\nOpen in staff console: ${deepLink}`:""}`;
  const response=await fetcher("https://api.resend.com/emails",{
    method:"POST",
    headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      from:env.CUSTOMER_EMAIL_FROM,to:[env.OPS_NOTIFY_EMAIL],
      subject:`New message from ${row.full_name} — ${profile.shortName}`,
      text,
    }),
  });
  if(!response.ok)throw new Error(`Resend rejected the ops notification (${response.status})`);
}

export async function dispatchConsultingInquiryNotificationEmail(
  env:Env,
  event:ConsultingInquiryNotificationEvent,
  fetcher:typeof fetch=fetch,
):Promise<void>{
  const profile=resolveClientBusinessProfile(env.BUSINESS_PROFILE);
  if(!profile.capabilities.opsNotifyEmail)return;
  if(!env.RESEND_API_KEY||!env.CUSTOMER_EMAIL_FROM||!env.OPS_NOTIFY_EMAIL){
    console.warn(JSON.stringify({message:"consulting inquiry notification skipped: not configured",inquiryId:event.inquiryId}));
    return;
  }
  const row=await env.DB.prepare(`SELECT c.full_name,c.email,c.phone,cd.organization,cd.situation_problem,
      i.source_channel,s.landing_page,s.utm_source,s.utm_medium,s.utm_campaign
    FROM inquiries i
    JOIN contacts c ON c.id=i.contact_id
    JOIN consulting_details cd ON cd.inquiry_id=i.id
    LEFT JOIN intake_submissions s ON s.inquiry_id=i.id
    WHERE i.id=?
    ORDER BY s.received_at DESC
    LIMIT 1`).bind(event.inquiryId).first<ConsultingInquiryRow>();
  if(!row)return;
  const deepLink=env.STAFF_CONSOLE_ORIGIN?`${env.STAFF_CONSOLE_ORIGIN.replace(/\/$/,"")}/#/inquiry/${encodeURIComponent(event.inquiryId)}`:null;
  const attribution=[
    row.source_channel?`Source: ${row.source_channel}`:null,
    row.landing_page?`Landing page: ${row.landing_page}`:null,
    row.utm_source?`UTM source: ${row.utm_source}`:null,
    row.utm_medium?`UTM medium: ${row.utm_medium}`:null,
    row.utm_campaign?`UTM campaign: ${row.utm_campaign}`:null,
  ].filter(Boolean).join("\n");
  const text=`New consulting inquiry from ${row.full_name}

What's not working:
${row.situation_problem??"Not supplied"}

Organization: ${row.organization??"Not supplied"}
Email: ${row.email??"Not supplied"}
Phone: ${row.phone??"Not supplied"}
${attribution?`\n${attribution}\n`:""}${deepLink?`\nOpen in staff console: ${deepLink}`:""}`;
  const response=await fetcher("https://api.resend.com/emails",{
    method:"POST",
    headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      from:env.CUSTOMER_EMAIL_FROM,to:[env.OPS_NOTIFY_EMAIL],
      subject:`New consulting inquiry from ${row.full_name} — ${profile.shortName}`,
      text,
    }),
  });
  if(!response.ok)throw new Error(`Resend rejected the consulting inquiry notification (${response.status})`);
}
