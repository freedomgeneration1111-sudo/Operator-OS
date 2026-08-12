export type ConversationReplyEmail={
  to:string;
  customerFirstName:string|null;
  resumeUrl:string;
  idempotencyKey:string;
};
export type CustomerEmailResult={providerMessageId:string};

export interface CustomerNotificationEmailProvider{
  readonly name:string;
  sendConversationReplyNotification(message:ConversationReplyEmail):Promise<CustomerEmailResult>;
}

export class CustomerEmailConfigurationError extends Error{}
export class CustomerEmailDeliveryError extends Error{constructor(readonly category:string,message:string){super(message);}}

export function createCustomerNotificationEmailProvider(env:Env,fetcher:typeof fetch=fetch):CustomerNotificationEmailProvider{
  if(!env.RESEND_API_KEY||!env.CUSTOMER_EMAIL_FROM)throw new CustomerEmailConfigurationError("Customer reply email is not configured");
  return new ResendCustomerNotificationEmailProvider(env.RESEND_API_KEY,env.CUSTOMER_EMAIL_FROM,fetcher);
}

export class ResendCustomerNotificationEmailProvider implements CustomerNotificationEmailProvider{
  readonly name="resend";
  constructor(private readonly apiKey:string,private readonly from:string,private readonly fetcher:typeof fetch=fetch){}
  async sendConversationReplyNotification(message:ConversationReplyEmail):Promise<CustomerEmailResult>{
    const greeting=message.customerFirstName?`Hi ${message.customerFirstName},`:"Hello,";
    const text=`${greeting}\n\nFocus Lab Productions replied to your message. A reply is waiting in your secure Focus Lab conversation.\n\nContinue conversation: ${message.resumeUrl}\n\nThis is a transactional notification about your conversation with Focus Lab Productions.`;
    const response=await this.fetcher("https://api.resend.com/emails",{
      method:"POST",
      headers:{Authorization:`Bearer ${this.apiKey}`,"Content-Type":"application/json","Idempotency-Key":message.idempotencyKey},
      body:JSON.stringify({
        from:this.from,to:[message.to],subject:"Focus Lab replied to your message",
        text,
        html:emailHtml(greeting,message.resumeUrl),
      }),
    });
    const body=await response.json().catch(()=>null) as {id?:unknown;message?:unknown;name?:unknown}|null;
    if(!response.ok||typeof body?.id!=="string"){
      const category=response.status===429?"rate_limited":response.status>=500?"provider_unavailable":"provider_rejected";
      throw new CustomerEmailDeliveryError(category,`Resend rejected the notification (${response.status})`);
    }
    return{providerMessageId:body.id};
  }
}

function emailHtml(greeting:string,resumeUrl:string){
  const safeGreeting=escapeHtml(greeting);const safeUrl=escapeHtml(resumeUrl);
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f7f5f1;color:#111214;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #c9c5bd;border-radius:18px;padding:28px"><p style="margin:0 0 16px">${safeGreeting}</p><h1 style="font-size:24px;line-height:1.25;margin:0 0 12px">Focus Lab Productions replied to your message</h1><p style="line-height:1.6;margin:0 0 24px">A reply is waiting in your secure Focus Lab conversation.</p><p style="margin:0 0 24px"><a href="${safeUrl}" style="display:inline-block;background:#f47a00;color:#fff;text-decoration:none;font-weight:700;padding:14px 18px;border-radius:12px">Continue conversation</a></p><p style="color:#5d6064;font-size:13px;line-height:1.5;margin:0">This is a transactional notification about your conversation with Focus Lab Productions.</p></div></div></body></html>`;
}
function escapeHtml(value:string){return value.replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]!));}
