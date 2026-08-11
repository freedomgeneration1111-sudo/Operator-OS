export type PublicSiteEnv={ASSETS:{fetch(request:Request):Promise<Response>};OPERATIONS_API:{fetch(request:Request):Promise<Response>}};

export async function handlePublicSite(request:Request,env:PublicSiteEnv):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(path==="/v1/inquiries"||path==="/v1/chat/status"||path==="/health")return env.OPERATIONS_API.fetch(request);
  return env.ASSETS.fetch(request);
}

export default{fetch:handlePublicSite} satisfies ExportedHandler<PublicSiteEnv>;
