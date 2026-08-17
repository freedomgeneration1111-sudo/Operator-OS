import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig,type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolveBusinessProfile,type BusinessProfile } from "../business-profiles.mts";
import { serviceWorkerFor } from "./src/lib/service-worker-source.mts";

const repositoryRoot=fileURLToPath(new URL("../..",import.meta.url));

export default defineConfig(()=>{
  const selected=resolveBusinessProfile(process.env.VITE_BUSINESS_PROFILE);
  const {logoSource,...profile}=selected;
  return{
    plugins:[react(),profileAssets(profile,logoSource)],
    root:fileURLToPath(new URL(".",import.meta.url)),
    publicDir:false as const,
    define:{__BUSINESS_PROFILE__:JSON.stringify(profile)},
    build:{outDir:"dist",emptyOutDir:true},
    server:{port:5173,strictPort:true},
  };
});

function profileAssets(profile:BusinessProfile,logoSource:string|null):Plugin{
  const manifest=manifestFor(profile);
  const worker=serviceWorkerFor(profile);
  const logo=logoSource?readFileSync(resolve(repositoryRoot,logoSource),"utf8"):null;
  return{
    name:"operator-business-profile-assets",
    transformIndexHtml(html){
      return html
        .replace("Operator Operations",escapeHtml(profile.appName))
        .replace("Internal operator workspace",escapeHtml(profile.appDescription))
        .replace("<!--PROFILE_ICON-->",profile.logoUrl?'<link rel="icon" href="/app-mark.svg" type="image/svg+xml" /><link rel="apple-touch-icon" href="/app-mark.svg" />':"");
    },
    configureServer(server){
      server.middlewares.use((request,response,next)=>{
        if(request.url==="/manifest.webmanifest")return send(response,manifest,"application/manifest+json");
        if(request.url==="/sw.js")return send(response,worker,"text/javascript");
        if(request.url==="/app-mark.svg"&&logo)return send(response,logo,"image/svg+xml");
        next();
      });
    },
    generateBundle(){
      this.emitFile({type:"asset",fileName:"manifest.webmanifest",source:manifest});
      this.emitFile({type:"asset",fileName:"sw.js",source:worker});
      if(logo)this.emitFile({type:"asset",fileName:"app-mark.svg",source:logo});
    },
  };
}
function send(response:import("node:http").ServerResponse,body:string,contentType:string){
  response.statusCode=200;response.setHeader("Content-Type",contentType);response.end(body);
}
export function manifestFor(profile:BusinessProfile){
  return JSON.stringify({
    name:profile.appName,short_name:`${profile.shortName} Ops`,description:profile.appDescription,
    start_url:"/#/inbox",scope:"/",display:"standalone",background_color:"#f4f0e8",theme_color:"#171512",
    ...(profile.logoUrl?{icons:[{src:"/app-mark.svg",sizes:"any",type:"image/svg+xml",purpose:"any maskable"}]}:{}),
  });
}
function escapeHtml(value:string){return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");}
