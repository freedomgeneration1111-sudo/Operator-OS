export type ChatAlertKind="conversation:new"|"message:new";
const preferenceKey="focuslab.staff.chatSounds.v1";
export function soundsEnabled(storage:Pick<Storage,"getItem">=localStorage){return storage.getItem(preferenceKey)!=="off";}
export function setSoundsEnabled(enabled:boolean,storage:Pick<Storage,"setItem">=localStorage){storage.setItem(preferenceKey,enabled?"on":"off");}
export function createAlertDeduplicator(limit=200){const seen=new Set<string>();return(id:string)=>{if(seen.has(id))return false;seen.add(id);if(seen.size>limit){const oldest=seen.values().next().value;if(oldest)seen.delete(oldest);}return true;};}
let sharedContext:AudioContext|undefined;
function audioContext(){const AudioContextClass=window.AudioContext||(window as typeof window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!AudioContextClass)return undefined;sharedContext??=new AudioContextClass();return sharedContext;}
export async function unlockChatAudio(){const context=audioContext();if(context?.state==="suspended")await context.resume();}
export async function playChatChime(kind:ChatAlertKind){const context=audioContext();if(!context)return;if(context.state==="suspended")await context.resume();const notes=kind==="conversation:new"?[523.25,659.25,783.99]:[659.25];const start=context.currentTime;notes.forEach((frequency,index)=>{const oscillator=context.createOscillator();const gain=context.createGain();const at=start+index*.1;oscillator.frequency.value=frequency;oscillator.type="sine";gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.16,at+.015);gain.gain.exponentialRampToValueAtTime(.0001,at+.16);oscillator.connect(gain).connect(context.destination);oscillator.start(at);oscillator.stop(at+.18);});}
