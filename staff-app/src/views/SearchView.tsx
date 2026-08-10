import type { OperationsClient } from "../lib/api";
import type { Responder } from "../lib/types";
import { InboxView } from "./InboxView";
export function SearchView({ client,responders,currentResponderId }:{client:OperationsClient;responders:Responder[];currentResponderId:string}){return <InboxView client={client} responders={responders} currentResponderId={currentResponderId} title="Search CRM"/>;}
