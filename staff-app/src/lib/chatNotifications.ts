export type ChatAlertKind="conversation:new"|"message:new";
export type ChatAudioState="uninitialized"|"running"|"suspended"|"closed"|"unsupported"|"interrupted";
export type ChatAlertEvent={id:string;type:ChatAlertKind;conversationId:string};
const preferenceKey="focuslab.staff.chatSounds.v1";
export function soundsEnabled(storage:Pick<Storage,"getItem">=localStorage){return storage.getItem(preferenceKey)!=="off";}
export function setSoundsEnabled(enabled:boolean,storage:Pick<Storage,"setItem">=localStorage){storage.setItem(preferenceKey,enabled?"on":"off");}
export function createAlertDeduplicator(limit=200){const seen=new Set<string>();return(id:string)=>{if(seen.has(id))return false;seen.add(id);if(seen.size>limit){const oldest=seen.values().next().value;if(oldest)seen.delete(oldest);}return true;};}

type AudioContextFactory=()=>AudioContext|undefined;
export function createChatAudioController(factory:AudioContextFactory){
  let context:AudioContext|undefined;
  const getContext=()=>context??=factory();
  const state=():ChatAudioState=>context?.state??(typeof window==="undefined"?"unsupported":"uninitialized");
  return {
    state,
    async unlock(){
      try{const current=getContext();if(!current)return"unsupported" as const;if(current.state==="suspended"||current.state==="interrupted")await current.resume();return state();}
      catch{return state();}
    },
    async play(kind:ChatAlertKind){
      try{
        const current=getContext();if(!current)return false;
        if(current.state==="suspended"||current.state==="interrupted")await current.resume();
        if(current.state!=="running")return false;
        const notes=kind==="conversation:new"?[523.25,659.25,783.99]:[659.25];const start=current.currentTime;
        notes.forEach((frequency,index)=>{const oscillator=current.createOscillator();const gain=current.createGain();const at=start+index*.1;oscillator.frequency.value=frequency;oscillator.type="sine";gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.16,at+.015);gain.gain.exponentialRampToValueAtTime(.0001,at+.16);oscillator.connect(gain).connect(current.destination);oscillator.start(at);oscillator.stop(at+.18);});
        return true;
      }catch{return false;}
    },
  };
}
function browserAudioContext(){if(typeof window==="undefined")return undefined;const Constructor=window.AudioContext||(window as typeof window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;return Constructor?new Constructor():undefined;}
export const chatAudio=createChatAudioController(browserAudioContext);

export async function notifyChatEvent(event:ChatAlertEvent,options:{sounds:boolean;activeConversationId?:string;acceptEvent:(id:string)=>boolean},player:Pick<typeof chatAudio,"play">=chatAudio){
  if(!options.acceptEvent(event.id)||!options.sounds)return false;
  try{return await player.play(event.type);}catch{return false;}
}
