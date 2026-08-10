import type { WorkflowState } from "./types";
export function buildInboxParams({ query,workflow,assignment,currentResponderId,offset }:{ query:string;workflow:WorkflowState|"active"|"all";assignment:string;currentResponderId:string;offset:number }){
  const value=new URLSearchParams({ limit:"25",offset:String(offset) });
  if(query.trim())value.set("query",query.trim());
  if(workflow!=="all"&&workflow!=="active")value.set("workflow",workflow);
  if(assignment==="mine")value.set("assignment",currentResponderId);
  else if(assignment==="unassigned")value.set("assignment","unassigned");
  else if(assignment!=="all")value.set("assignment",assignment);
  return value;
}
