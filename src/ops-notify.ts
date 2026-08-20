import { resolveClientBusinessProfile } from "../business-profiles.mts";

export type OpsNotification={
  name:string;
  email:string;
  phone:string|null;
  message:string;
  replyEmail:boolean;
  replySms:boolean;
  replyCall:boolean;
};

export async function sendOpsNotification(env:Env,notification:OpsNotification,fetcher:typeof fetch=fetch):Promise<void>{
  if(!env.RESEND_API_KEY||!env.CUSTOMER_EMAIL_FROM||!env.OPS_NOTIFY_EMAIL){
    console.warn(JSON.stringify({message:"ops notification skipped: not configured"}));
    return;
  }
  const profile=resolveClientBusinessProfile(env.BUSINESS_PROFILE);
  const preferences=[notification.replyEmail?"Email":null,notification.replySms?"Text":null,notification.replyCall?"Call":null].filter(Boolean).join(", ")||"None selected";
  const text=`New message from ${notification.name}\n\n${notification.message}\n\nEmail: ${notification.email}\nPhone: ${notification.phone??"Not supplied"}\nReply preferences: ${preferences}`;
  const response=await fetcher("https://api.resend.com/emails",{
    method:"POST",
    headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      from:env.CUSTOMER_EMAIL_FROM,to:[env.OPS_NOTIFY_EMAIL],
      subject:`New message from ${notification.name} — ${profile.shortName}`,
      text,
    }),
  });
  if(!response.ok)throw new Error(`Resend rejected the ops notification (${response.status})`);
}
