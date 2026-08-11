# Operations API contract notes

`openapi.yaml` is the machine-readable base contract. These notes define protected mutation bodies and the implemented Access-authentication plus D1-authorization boundary.

| Endpoint | Method | Auth | Request | Success |
|---|---|---|---|---|
| `/v1/inquiries` | POST | Public; `Idempotency-Key` required | Existing website inquiry fields, Turnstile token, empty honeypot; strict JSON schema | `201` persisted or `200` idempotent replay; status is `received_for_review`, never availability |
| `/v1/chat/status` | GET | Public | None | `live`, `async`, or `unavailable`; no internal responder data |
| `/v1/internal/me` | GET | Access JWT + D1 role | None | Minimal current-user role and availability context |
| `/v1/internal/presence/heartbeat` | POST | Access JWT + D1 role | `{ available: boolean }` | Presence state and expiry |
| `/v1/internal/inquiries` | GET | Access JWT + D1 role | Optional `?query=` | Up to 100 internal inquiry summaries |
| `/v1/internal/inquiries/{id}` | GET | Access JWT + D1 role | None | Contact/event/inquiry plus services, assignments, notes, activities, conversations |
| `/v1/internal/inquiries/{id}/workflow` | PATCH | Access JWT + D1 role | `{ state: "new"|"reviewing"|"qualified"|"quoted"|"won"|"lost"|"archived" }` | Updated state/timestamp |
| `/v1/internal/inquiries/{id}/notes` | POST | Access JWT + D1 role | `{ body: string }` | Internal note ID/timestamp |
| `/v1/internal/inquiries/{id}/assignment` | PATCH | Access JWT + D1 role | `{ responderId: string, assigned: boolean }` | Assignment state/timestamp |
| `/v1/internal/inquiries/{id}/capacity` | PATCH | Access JWT + D1 role | `{ blocksCapacity: boolean }` | Capacity-blocking state/timestamp |
| `/v1/internal/inquiries/{id}/conflicts` | GET | Access JWT + D1 role | None | Internal scheduling assessment |
| `/v1/internal/responders` | GET | Access JWT + D1 role | None | Active internal responders and presence |
| `/v1/internal/status` | GET | Access JWT + D1 role | None | Chat/provider state, active responders, timeout, capacity |
| `/v1/internal/inbox` | GET | Access JWT + D1 role | Bounded filters and pagination | Staff inbox page, max 50 |
| `/v1/internal/schedule` | GET | Access JWT + D1 role | Required date range | Events with internal conflict assessments |
| `/v1/internal/conversations` | GET | Access JWT + D1 role | Optional query | Metadata only; no message bodies |

`POST /v1/inquiries` validates Turnstile with Siteverify, rejects a filled honeypot, and applies the Worker rate-limit binding before persistence. Turnstile secrets never enter the browser. A `429` is retryable after the one-minute window; verification/infrastructure failures fail closed.

All JSON mutation bodies reject unknown fields. Validation failures use `422`; malformed JSON or idempotency metadata uses `400`; missing internal auth uses `401`; missing records use `404`; unexpected persistence failures use a generic `500` without exposing SQL or private data.

Production uses validated Cloudflare Access assertions plus active D1 staff roles. The bearer adapter is development-only and cannot activate in staging or production.

## Production staff authentication

Production internal requests require a cryptographically valid Cloudflare Access `Cf-Access-Jwt-Assertion`, followed by an active D1 responder mapping and role permission. Development bearer auth exists only when both development mode flags are explicit and also binds a synthetic responder identity. Caller-supplied `actorId` fields are rejected; audit actors come from the authenticated identity.

`GET /v1/internal/me` returns `{ id, displayName, role, verifiedEmail, authMode, availabilityState }` for the authenticated staff member. Responder roles may self-assign, add notes, update normal workflow, and control their own presence. Manager/admin roles may assign others and change capacity-blocking state.
