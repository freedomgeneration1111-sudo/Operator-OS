import { humanize } from "../lib/format";
import type { ConflictStatus,WorkflowState } from "../lib/types";
const conflictLabels:Record<ConflictStatus,string>={ clear:"Clear",potential_conflict:"Possible overlap",capacity_conflict:"Capacity conflict",review_required:"Needs review" };
export function WorkflowBadge({ state }:{ state:WorkflowState }){return <span className={`badge workflow-${state}`}>{humanize(state)}</span>;}
export function ConflictBadge({ state }:{ state:ConflictStatus }){return <span className={`badge conflict-${state}`}>{conflictLabels[state]}</span>;}
export function CapacityBadge({ blocks }:{ blocks:boolean }){return <span className={`badge ${blocks?"capacity-blocking":"capacity-open"}`}>{blocks?"Blocks capacity":"Opportunity only"}</span>;}
