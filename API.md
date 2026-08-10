# Operations API contract notes

`openapi.yaml` is the machine-readable base contract. These notes make the protected mutation bodies and operational guarantees explicit while staff authentication remains unresolved.

| Endpoint | Method | Auth | Request | Success |
|---|---|---|---|---|
| `/v1/inquiries` | POST | Public; `Idempotency-Key` required | Existing website inquiry fields; strict JSON schema | `201` persisted or `200` idempotent replay; status is `received_for_review`, never availability |
| `/v1/chat/status` | GET | Public | None | `live`, `async`, or `unavailable`; no internal responder data |
| `/v1/internal/presence/heartbeat` | POST | Provisional bearer | `{ responderId: string, available: boolean }` | Presence state and expiry |
| `/v1/internal/inquiries` | GET | Provisional bearer | Optional `?query=` | Up to 100 internal inquiry summaries |
| `/v1/internal/inquiries/{id}` | GET | Provisional bearer | None | Contact/event/inquiry plus services, assignments, notes, activities, conversations |
| `/v1/internal/inquiries/{id}/workflow` | PATCH | Provisional bearer | `{ state: "new"|"reviewing"|"qualified"|"quoted"|"won"|"lost"|"archived", actorId?: string }` | Updated state/timestamp |
| `/v1/internal/inquiries/{id}/notes` | POST | Provisional bearer | `{ body: string, actorId?: string }` | Internal note ID/timestamp |
| `/v1/internal/inquiries/{id}/assignment` | PATCH | Provisional bearer | `{ responderId: string, assigned: boolean, actorId?: string }` | Assignment state/timestamp |
| `/v1/internal/inquiries/{id}/capacity` | PATCH | Provisional bearer | `{ blocksCapacity: boolean, actorId?: string }` | Capacity-blocking state/timestamp |
| `/v1/internal/inquiries/{id}/conflicts` | GET | Provisional bearer | None | Internal scheduling assessment |
| `/v1/internal/responders` | GET | Provisional bearer | None | Active internal responders and presence |
| `/v1/internal/status` | GET | Provisional bearer | None | Chat/provider state, active responders, timeout, capacity |
| `/v1/internal/inbox` | GET | Provisional bearer | Bounded filters and pagination | Staff inbox page, max 50 |
| `/v1/internal/schedule` | GET | Provisional bearer | Required date range | Events with internal conflict assessments |
| `/v1/internal/conversations` | GET | Provisional bearer | Optional query | Metadata only; no message bodies |

All JSON mutation bodies reject unknown fields. Validation failures use `422`; malformed JSON or idempotency metadata uses `400`; missing internal auth uses `401`; missing records use `404`; unexpected persistence failures use a generic `500` without exposing SQL or private data.

The bearer mechanism is a fail-closed development boundary only. It must be replaced or fronted by approved staff identity and authorization before production CRM use.
