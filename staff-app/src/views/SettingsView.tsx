import type { OperationsStatus,Responder } from "../lib/types";
import { presencePresentation,type HeartbeatState } from "../lib/heartbeat";
import { formatDateTime } from "../lib/format";
import type { OperationsClient } from "../lib/api";
import { usePushNotifications,type PushDiagnostics } from "../lib/pushNotifications";
import { businessProfile } from "../lib/business-profile";

export function SettingsView({ client,status,responders,currentResponderId,availability,onAvailability }:{
  client:OperationsClient;status:OperationsStatus|null;responders:Responder[];currentResponderId:string;
  availability:{enabled:boolean;state:HeartbeatState};onAvailability:(next:boolean)=>void;
}){
  const presence=presencePresentation(availability.enabled,availability.state);
  const notifications=usePushNotifications(client);
  const showDiagnostics=import.meta.env.VITE_APP_STAGE==="staging";
  return <section className="view">
    <div className="view-heading"><div><p className="eyebrow">Responder & System</p><h1>Status</h1><p>Manage notifications, live-chat availability, and shared customer state.</p></div></div>
    <div className="settings-grid">
      <section className="panel notification-panel">
        <h2>Notifications</h2>
        <strong className={"notification-state "+notifications.state}>{notificationLabel(notifications.state)}</strong>
        <p className="help-text" role="status" aria-live="polite">{notifications.message}</p>
        <div className="notification-actions">
          {notifications.state==="enabled"?<>
            <button className="button primary" disabled={notifications.busy} onClick={()=>void notifications.test()}>{notifications.busy?"Working…":"Send test notification"}</button>
            <button className="button secondary" disabled={notifications.busy} onClick={()=>void notifications.disable()}>Disable notifications</button>
          </>:notifications.state==="available"||notifications.state==="error"?<button className="button primary" disabled={notifications.busy} onClick={()=>void notifications.enable()}>{notifications.busy?"Enabling…":"Enable notifications"}</button>:null}
          <button className="button secondary" disabled={notifications.busy} onClick={()=>void notifications.refresh()}>Check again</button>
        </div>
        {notifications.state==="enabled"?<p className="test-result" role="status" aria-live="polite"><strong>Push subscription:</strong> {notifications.diagnostics.d1Registered?"Active":"Not registered"}<br/><strong>Last test:</strong> {notifications.lastTest}</p>:null}
        {showDiagnostics?<PushDiagnosticDetails diagnostics={notifications.diagnostics}/>:null}
      </section>
      <section className="panel availability-panel">
        <h2>Your Live-Chat Availability</h2><p>Assignment and live availability are separate. This control only affects responder presence.</p>
        <button className={"availability-button "+(presence.confirmedLive?"is-live":"")} onClick={()=>onAvailability(!availability.enabled)}><span aria-hidden="true">●</span><strong>{presence.label}</strong><small>{presence.detail}</small></button>
        <p className="help-text">Presence expires server-side if this app stops sending heartbeats. Briefly switching apps does not immediately mark you unavailable.</p>
      </section>
      <section className="panel"><h2>Aggregate Customer Chat</h2><dl><dt>Public state</dt><dd>{status?.chat.label??"Checking…"}</dd><dt>Active responders</dt><dd>{status?.activeResponders.length??0}</dd><dt>Provider</dt><dd>{status?.messaging.provider??"Not configured"}</dd><dt>Heartbeat timeout</dt><dd>{status?.presenceTimeoutSeconds??"—"} seconds</dd>{businessProfile.capabilities.capacity?<><dt>Event capacity</dt><dd>{status?.eventCapacity??"—"}</dd></>:null}</dl></section>
      <section className="panel span-two"><h2>Internal Responders</h2><div className="responder-list">{responders.map((responder)=><article key={responder.id}><div><strong>{responder.display_label}{responder.id===currentResponderId?" (you)":""}</strong><p>{responder.currently_available===1?"Available for live chat":"Not currently live"}</p></div><div><span className={"connection "+(responder.currently_available===1?"online":"offline")}><span aria-hidden="true">●</span> {responder.currently_available===1?"Live":"Offline"}</span><small>{responder.heartbeat_at?"Last heartbeat "+formatDateTime(responder.heartbeat_at):"No heartbeat recorded"}</small></div></article>)}</div></section>
    </div>
  </section>;
}

function PushDiagnosticDetails({diagnostics}:{diagnostics:PushDiagnostics}){
  return <details className="push-diagnostics" open>
    <summary>Notification Diagnostics</summary>
    <dl>
      <dt>Secure context</dt><dd>{yesNo(diagnostics.secureContext)}</dd>
      <dt>Service Worker API</dt><dd>{yesNo(diagnostics.serviceWorkerApi)}</dd>
      <dt>PushManager API</dt><dd>{yesNo(diagnostics.pushManagerApi)}</dd>
      <dt>Notification API</dt><dd>{yesNo(diagnostics.notificationApi)}</dd>
      <dt>Permission</dt><dd>{diagnostics.permission}</dd>
      <dt>Active service worker</dt><dd>{yesNo(diagnostics.registrationActive)}</dd>
      <dt>Page controlled</dt><dd>{yesNo(diagnostics.serviceWorkerControlled)}</dd>
      <dt>Service worker version</dt><dd className="break-words">{diagnostics.serviceWorkerVersion??"Not reported"}</dd>
      <dt>Registration PushManager</dt><dd>{yesNo(diagnostics.registrationPushManager)}</dd>
      <dt>Browser subscription</dt><dd>{yesNo(diagnostics.pushSubscription)}</dd>
      <dt>VAPID configuration</dt><dd>{known(diagnostics.vapidConfigured)}</dd>
      <dt>Registration API</dt><dd>{diagnostics.serverRegistration}</dd>
      <dt>D1 subscription</dt><dd>{known(diagnostics.d1Registered)}</dd>
      <dt>D1 devices for responder</dt><dd>{diagnostics.d1SubscriptionCount??"Not checked"}</dd>
      <dt>Foreground lease until</dt><dd className="break-words">{diagnostics.activeUntil??"None"}</dd>
      <dt>Last push success</dt><dd className="break-words">{diagnostics.lastSuccessfulDelivery??"None"}</dd>
      <dt>Last push failure</dt><dd className="break-words">{diagnostics.lastDeliveryFailure??"None"}</dd>
      <dt>Error stage</dt><dd>{diagnostics.errorStage??"None"}</dd>
    </dl>
  </details>;
}
function yesNo(value:boolean){return value?"Yes":"No";}
function known(value:boolean|null){return value===null?"Not checked":yesNo(value);}
function notificationLabel(state:ReturnType<typeof usePushNotifications>["state"]){if(state==="enabled")return"Notifications: Enabled ✓";if(state==="blocked")return"Notifications: Blocked";if(state==="unsupported")return"Notifications: Unsupported";if(state==="error")return"Notifications: Error";if(state==="checking")return"Notifications: Checking…";return"Notifications: Not Enabled";}
