export type PublicSiteEnv = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  OPERATIONS_API: { fetch(request: Request): Promise<Response> };
};

export async function handlePublicSite(request: Request, env: PublicSiteEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/v1/inquiries" || path === "/v1/chat/status" || path === "/v1/chat/resume" || path.startsWith("/v1/chat/conversations") || path === "/health") {
    return env.OPERATIONS_API.fetch(request);
  }

  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export default { fetch: handlePublicSite } satisfies ExportedHandler<PublicSiteEnv>;
