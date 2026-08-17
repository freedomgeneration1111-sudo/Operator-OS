# Operations API contract notes

`openapi.yaml` is the machine-readable base contract. These notes define protected mutation bodies and the implemented Access-authentication plus D1-authorization boundary.

| Endpoint | Method | Auth | Request | Success |
|---|---|---|---|---|
| `/v1/inquiries` | POST | Public; `Idempotency-Key` required | Focus event-inquiry fields, optional attribution, Turnstile token, empty honeypot; strict JSON schema | `201` persisted or `200` idempotent replay; real `eventId`; status is `received_for_review`, never availability |
| `/v1/chat/status` | GET | Public | None | Native channel is `live` or `async`; no internal responder data |
| `/v1/chat/conversations` | POST | Public + rate limit/honeypot | Bounded contact and initial message | Conversation ID, one-time resume token, persisted first message |
| `/v1/chat/conversations/{id}/messages` | GET/POST | Public resume token | Bounded message with client ID for POST | Public-safe ordered history or persisted message |
| `/v1/chat/conversations/{id}/socket` | GET upgrade | Public resume token | WebSocket | Hibernating real-time conversation stream |
| `/v1/internal/me` | GET | Access JWT + D1 role | None | Minimal current-user role and availability context |
| `/v1/internal/presence/heartbeat` | POST | Access JWT + D1 role | `{ available: boolean }` | Presence state and expiry |
| `/v1/internal/inquiries` | GET | Access JWT + D1 role | Optional `?query=` | Up to 100 internal inquiry summaries |
| `/v1/internal/inquiries/{id}` | GET | Access JWT + D1 role | None | Contact/inquiry, optional Event and Consulting extensions, provenance, services, assignments, notes, activities, conversations |
| `/v1/internal/inquiries/{id}/workflow` | PATCH | Access JWT + D1 role | `{ state: "new"|"reviewing"|"qualified"|"quoted"|"won"|"lost"|"archived" }` | Updated state/timestamp |
| `/v1/internal/inquiries/{id}/notes` | POST | Access JWT + D1 role | `{ body: string }` | Internal note ID/timestamp |
| `/v1/internal/inquiries/{id}/assignment` | PATCH | Access JWT + D1 role | `{ responderId: string, assigned: boolean }` | Assignment state/timestamp |
| `/v1/internal/inquiries/{id}/capacity` | PATCH | Access JWT + D1 role | `{ blocksCapacity: boolean }` | Capacity-blocking state/timestamp; `409 event_extension_required` for eventless inquiries |
| `/v1/internal/inquiries/{id}/conflicts` | GET | Access JWT + D1 role | None | Internal scheduling assessment; `409 event_extension_required` for eventless inquiries |
| `/v1/internal/responders` | GET | Access JWT + D1 role | None | Active internal responders and presence |
| `/v1/internal/status` | GET | Access JWT + D1 role | None | Chat/provider state, active responders, timeout, capacity |
| `/v1/internal/inbox` | GET | Access JWT + D1 role | Bounded filters and pagination | Staff inbox page, max 50 |
| `/v1/internal/schedule` | GET | Access JWT + D1 role | Required date range | Events with internal conflict assessments |
| `/v1/internal/conversations` | GET | Access JWT + D1 role | Optional query | Conversation summaries, assignment and unread counts |
| `/v1/internal/conversations/{id}` | GET | Access JWT + D1 role | None | Customer context, messages and audit activity |
| `/v1/internal/conversations/{id}/messages` | POST | Access JWT + D1 role | Bounded reply + client message ID | Persisted responder-attributed reply |
| `/v1/internal/conversations/{id}/assignment` | PATCH | Access JWT + D1 role | `{ responderId: string|null }` | Audited conversation assignment |
| `/v1/internal/conversations/{id}/read` | POST | Access JWT + D1 role | None | Authenticated responder read position |
| `/v1/internal/chat/socket` | GET upgrade | Access JWT + D1 role | WebSocket | Routed non-PII staff chat events |

`POST /v1/inquiries` validates Turnstile with Siteverify, rejects a filled honeypot, and applies the Worker rate-limit binding before persistence. Turnstile secrets never enter the browser. A `429` is retryable after the one-minute window; verification/infrastructure failures fail closed.

The inquiry application service is the authoritative transaction boundary. The current public route selects the Focus adapter (Event plus requested services); the typed Consulting adapter creates an Inquiry plus Consulting Detail with no Event. Both adapters preserve a bounded approved intake snapshot and queryable attribution. Tokens, honeypots, secrets, auth data, and arbitrary request JSON are excluded from provenance.

Deployment selection is build/config driven. `BUSINESS_PROFILE=focus` enables the existing public event-inquiry adapter and Event/Schedule/Capacity modules. `BUSINESS_PROFILE=moses` disables those modules; `PUBLIC_API_ENABLED=false` also fails closed for public inquiry/chat routes until a business deployment explicitly enables them. Disabled modules return `404 module_disabled` and do not mutate state. Health responses identify the selected business and deployment key without business-specific hardcoding.

Generic list, inbox, detail, and search contracts return Event and Consulting data as optional typed extensions. Eventless inquiries retain workflow, assignments, internal notes, activities, and conversation metadata. Conversations remain valid without either an Inquiry or Event.

All JSON mutation bodies reject unknown fields. Validation failures use `422`; malformed JSON or idempotency metadata uses `400`; missing internal auth uses `401`; missing records use `404`; event-module operations on eventless inquiries use `409` with `event_extension_required`; unexpected persistence failures use a generic `500` without exposing SQL or private data.

Production uses validated Cloudflare Access assertions plus active D1 staff roles. The bearer adapter is development-only and cannot activate in staging or production.

## Production staff authentication

Production internal requests require a cryptographically valid Cloudflare Access `Cf-Access-Jwt-Assertion`, followed by an active D1 responder mapping and role permission. Development bearer auth exists only when both development mode flags are explicit and also binds a synthetic responder identity. Caller-supplied `actorId` fields are rejected; audit actors come from the authenticated identity.

`GET /v1/internal/me` returns `{ id, displayName, role, verifiedEmail, authMode, availabilityState }` for the authenticated staff member. Responder roles may self-assign, add notes, update normal workflow, and control their own presence. Manager/admin roles may assign others and change capacity-blocking state.
