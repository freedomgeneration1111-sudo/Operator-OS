import type { ConsultingInquiryInput,FocusInquiryCreatedResponse,InquiryCreatedResponse,InquiryRequest } from "./contracts";
import { createInquiry,type CreateInquiryCommand } from "./inquiry-service";

const FOCUS_ACKNOWLEDGEMENT="Your inquiry was received for human review. This is not an availability confirmation.";
const CONSULTING_ACKNOWLEDGEMENT="Your inquiry was received for human review.";

export async function createFocusInquiry(db:D1Database,input:InquiryRequest,idempotencyKey:string,now:string):Promise<FocusInquiryCreatedResponse>{
  const result=await createInquiry(db,focusCommand(input,now),idempotencyKey,now);
  if(!result.eventId)throw new Error("Focus inquiry did not create an Event extension");
  return{...result,eventId:result.eventId};
}

export async function createConsultingInquiry(db:D1Database,input:ConsultingInquiryInput,idempotencyKey:string,now:string):Promise<InquiryCreatedResponse>{
  return createInquiry(db,consultingCommand(input,now),idempotencyKey,now);
}

export function focusCommand(input:InquiryRequest,now:string):CreateInquiryCommand{
  return{
    contact:{fullName:input.name,email:input.email,phone:input.phone,preferredContact:input.contact},
    inquiry:{sourceChannel:input.source??"website",budgetContext:input.budget,customerNote:input.note},
    intake:{formSchemaKey:"focus.website.event-inquiry",schemaVersion:1,origin:"focus_public_website",payload:{...input}},
    attribution:{referral:input.referral,landingPage:input.landingPage,referrer:input.referrer,utmSource:input.utmSource,utmMedium:input.utmMedium,utmCampaign:input.utmCampaign,utmTerm:input.utmTerm,utmContent:input.utmContent,capturedAt:now},
    extension:{kind:"event",eventFamily:input.eventType,startDate:input.date,endDate:input.endDate??input.date,startTime:input.startTime,endTime:input.endTime,venueLocation:input.location,guestCount:input.guests??null,services:input.services},
    acknowledgementMessage:FOCUS_ACKNOWLEDGEMENT,
  };
}

export function consultingCommand(input:ConsultingInquiryInput,now:string):CreateInquiryCommand{
  return{
    contact:{fullName:input.name,email:input.email,phone:input.phone,preferredContact:input.preferredContact},
    inquiry:{sourceChannel:input.source??"consulting_intake",budgetContext:input.budget,customerNote:input.note},
    intake:{formSchemaKey:"moses.website.consulting-inquiry",schemaVersion:1,origin:"moses_public_website",payload:{...input}},
    attribution:{referral:input.referralSource,landingPage:input.landingPage,referrer:input.referrer,utmSource:input.utmSource,utmMedium:input.utmMedium,utmCampaign:input.utmCampaign,utmTerm:input.utmTerm,utmContent:input.utmContent,capturedAt:now},
    extension:{kind:"consulting",organization:input.organization,offerServiceArea:input.offerServiceArea,situationProblem:input.situationProblem,desiredOutcome:input.desiredOutcome,timeline:input.timeline,budget:input.budget,countryRegion:input.countryRegion,referralSource:input.referralSource},
    acknowledgementMessage:CONSULTING_ACKNOWLEDGEMENT,
  };
}
