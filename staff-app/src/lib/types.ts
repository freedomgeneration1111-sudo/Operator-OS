export type WorkflowState="new"|"reviewing"|"qualified"|"quoted"|"won"|"lost"|"archived";
export type ConflictStatus="clear"|"potential_conflict"|"capacity_conflict"|"review_required";
export type StaffRole="admin"|"manager"|"responder";
export type StaffUser={id:string;displayName:string;role:StaffRole;verifiedEmail:string|null;authMode:"development"|"access";availabilityState:"available"|"unavailable"};
export type Responder={ id:string;role?:StaffRole;display_label:string;active:number;currently_available:number;heartbeat_at:string|null;expires_at:string|null };
export type ChatStatus={ state:"live"|"async"|"unavailable";label:string;destinationUrl:string|null;checkedAt:string };
export type OperationsStatus={
  ok:true;chat:ChatStatus;activeResponders:Array<{ id:string;display_label:string;heartbeat_at:string;expires_at:string }>;
  messaging:{ configured:boolean;provider:string|null };presenceTimeoutSeconds:number;eventCapacity:number;
};
export type InboxItem={
  id:string;workflow_state:WorkflowState;source_channel:string;created_at:string;updated_at:string;full_name:string;
  event_id:string|null;event_family:string|null;start_date:string|null;end_date:string|null;start_time:string|null;end_time:string|null;
  venue_location:string|null;blocks_capacity:number|null;scheduling_state:string|null;services:string|null;assignee_labels:string|null;assignee_ids:string|null;
  organization:string|null;offer_service_area:string|null;situation_problem:string|null;desired_outcome:string|null;timeline:string|null;
  consulting_budget:string|null;country_region:string|null;referral_source:string|null;
};
export type InboxResponse={ ok:true;inquiries:InboxItem[];page:{ limit:number;offset:number;total:number;hasMore:boolean } };
export type InquiryRecord={
  id:string;contact_id:string;event_id:string|null;source_channel:string;workflow_state:WorkflowState;
  budget_context:string|null;customer_note:string|null;created_at:string;updated_at:string;
  full_name:string;email:string|null;phone:string|null;preferred_contact:string|null;
  event_family:string|null;start_date:string|null;end_date:string|null;start_time:string|null;end_time:string|null;
  venue_location:string|null;guest_count:number|null;blocks_capacity:number|null;scheduling_state:string|null;
};
export type ConsultingDetail={
  organization:string|null;offer_service_area:string|null;situation_problem:string|null;desired_outcome:string|null;
  timeline:string|null;budget:string|null;country_region:string|null;referral_source:string|null;created_at:string;updated_at:string;
};
export type InquiryDetail={
  ok:true;inquiry:InquiryRecord;event:Record<string,unknown>|null;consulting:ConsultingDetail|null;
  intakeSubmissions:Array<{id:string;form_schema_key:string;schema_version:number;origin:string;source_channel:string;received_at:string}>;
  services:Array<{ service_name:string }>;
  assignments:Array<{ responder_id:string;display_label:string;assigned_at:string }>;
  notes:Array<{ id:string;author_responder_id:string|null;author_label:string|null;body:string;created_at:string }>;
  activities:Array<{ id:string;actor_kind:string;actor_id:string|null;activity_type:string;metadata_json:string;created_at:string }>;
  conversations:Array<{ id:string;provider:string;external_conversation_id:string|null;channel_state:string;created_at:string;updated_at:string }>;
};
export type Assessment={ status:ConflictStatus;conflicts:Array<{ id:string;certainty:"definite"|"potential" }>;blockingOverlapCount:number;capacity:number;requiresHumanReview:boolean };
export type ScheduleEvent={
  id:string;event_family:string|null;start_date:string;end_date:string|null;start_time:string|null;end_time:string|null;
  venue_location:string|null;blocks_capacity:number;scheduling_state:string;inquiry_id:string;workflow_state:WorkflowState;
  full_name:string;services:string|null;assessment:Assessment;
};
export type Conversation={ id:string;provider:string;external_conversation_id:string|null;channel_state:string;updated_at:string;inquiry_id:string|null;event_id:string|null;full_name:string;event_family:string|null;start_date:string|null;assigned_responder_id:string|null;last_message_at:string|null;unread_count:number;reply_email:number;reply_sms:number;reply_call:number };
export type ChatMessage={id:string;client_message_id:string;sequence:number;sender_kind:"customer"|"responder"|"system";sender_responder_id?:string|null;sender_label?:string|null;body:string;created_at:string};
export type CustomerNotification={status:"pending"|"accepted"|"failed";provider:string;attempted_at:string;completed_at:string|null;failure_code:string|null;cleared_at:string|null};
export type ConversationDetail={ok:true;conversation:Conversation&{email:string;phone:string|null;assigned_responder_label:string|null;created_at:string};messages:ChatMessage[];activity:Array<{actor_kind:string;actor_id:string|null;activity_type:string;metadata_json:string;created_at:string}>;customerNotification:CustomerNotification|null};

export const workflowStates: WorkflowState[]=["new","reviewing","qualified","quoted","won","lost","archived"];
