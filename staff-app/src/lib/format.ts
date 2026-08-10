export const dateFormatter=new Intl.DateTimeFormat(undefined,{ month:"short",day:"numeric",year:"numeric" });
export const dateTimeFormatter=new Intl.DateTimeFormat(undefined,{ month:"short",day:"numeric",hour:"numeric",minute:"2-digit" });
export function formatDate(value:string|null|undefined){ return value?dateFormatter.format(new Date(`${value}T12:00:00`)):"Date not supplied"; }
export function formatDateRange(start:string|null|undefined,end:string|null|undefined){ if(!start)return "Date not supplied";return end&&end!==start?`${formatDate(start)} – ${formatDate(end)}`:formatDate(start); }
export function formatDateTime(value:string|null|undefined){ return value?dateTimeFormatter.format(new Date(value)):"Not recorded"; }
export function splitPipe(value:string|null|undefined){ return value?value.split("|").filter(Boolean):[]; }
export function humanize(value:string){ return value.replaceAll("_"," ").replace(/^./,(letter)=>letter.toUpperCase()); }
export function text(value:unknown){ return typeof value==="string"&&value?value:null; }
export function numberValue(value:unknown){ return typeof value==="number"?value:typeof value==="string"?Number(value):null; }
