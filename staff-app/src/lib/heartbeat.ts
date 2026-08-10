export type HeartbeatState="off"|"starting"|"live"|"degraded"|"stopping";
export class HeartbeatController{
  private interval:number|null=null;
  private running=false;
  constructor(private readonly send:(available:boolean)=>Promise<void>,private readonly onState:(state:HeartbeatState,message?:string)=>void,private readonly timers:Pick<typeof window,"setInterval"|"clearInterval">=window){}
  async start(timeoutSeconds:number){
    if(this.running)return;
    this.running=true;this.onState("starting");
    await this.pulse();
    if(!this.running)return;
    const intervalMs=Math.min(60_000,Math.max(15_000,Math.floor(timeoutSeconds*1000/3)));
    this.interval=this.timers.setInterval(()=>{ void this.pulse(); },intervalMs);
  }
  async pulse(){
    if(!this.running)return;
    try{await this.send(true);if(this.running)this.onState("live");}
    catch{if(this.running)this.onState("degraded","Heartbeat failed. Server expiry remains authoritative.");}
  }
  async stop(notifyServer=true){
    if(!this.running&&this.interval===null)return;
    this.running=false;this.onState("stopping");
    if(this.interval!==null){this.timers.clearInterval(this.interval);this.interval=null;}
    if(notifyServer){try{await this.send(false);this.onState("off");}catch{this.onState("off","Could not confirm unavailable. Existing presence will expire automatically.");}}
    else this.onState("off");
  }
}
