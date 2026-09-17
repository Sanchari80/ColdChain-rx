# HTTP API

Base path: `/api/v1`. Everything is JSON. Authenticated routes need
`Authorization: Bearer <token>` from `POST /auth/login`.

## Open

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/health` | Liveness. Returns uptime and server time. |
| GET | `/capabilities` | Data mode, FHIR base URL, RxNorm source, cold-chain window, standards in use. Exposes no patient data. |

## Session

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| POST | `/auth/login` | — | Body `{ staffId, pin }`. Rate limited to 12 attempts per 10 minutes per IP. |
| GET | `/auth/me` | any | Echoes the decoded session. |

Demo accounts: `PHARM2201` / `8890` (pharmacist) and `NUR9931` / `4417` (nurse).

## Indents

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/indents?ward=&status=` | `indent:read` |
| GET | `/indents/:id` | `indent:read` |
| GET | `/indents/couriers` | `indent:read` |
| GET | `/indents/orderable` | `indent:request` |
| POST | `/indents/requests` `{ prescriptionId, doses, priority, note }` | `indent:request` |
| POST | `/indents/:id/verify` | `indent:verify` |
| POST | `/indents/:id/dispense` | `indent:dispense` |
| POST | `/indents/:id/receive` | `indent:receive` |
| POST | `/indents/:id/cancel` | `indent:cancel` |

`dispense` accepts `{ courierId?, overrideReason?, forceExcursion? }`. When
verification came back `review`, `overrideReason` is required and the request
fails with `409` without it. When verification came back `fail`, the request
fails with `403` whatever is sent.

## HL7 v2

| Method | Path | Scope |
| --- | --- | --- |
| POST | `/hl7/ingest` | `hl7:ingest` |
| GET | `/hl7/samples` | any |

`ingest` takes `{ message }` holding a raw OMP^O09. It answers with an ACK in
both the success and the failure case — `MSA|AA|...` or `MSA|AE|...` — because a
sender that gets no acknowledgement resends the order, and a resent pharmacy
order is a duplicate dose.

The response deliberately omits the parsed PID block; `parsed.patientIncluded`
is always `false`.

## Alerts

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/notifications?ward=&since=&limit=` | `notification:read` |
| GET | `/notifications/stream?ward=` | `notification:read` |
| POST | `/notifications/:id/read` | `notification:read` |
| POST | `/notifications/read-all` | `notification:read` |
| POST | `/notifications/devices` `{ token, platform }` | `notification:read` |
| POST | `/notifications/devices/remove` `{ token }` | signed in |

`/stream` is server-sent events. The mobile app polls instead: React Native has
no `EventSource`, and a six-second poll survives hospital wifi better than a
long-lived connection.

## Audit and cold chain

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/audit?limit=` | `audit:read` |
| GET | `/audit/integrity` | `audit:read` |
| GET | `/audit/fhir?limit=` | `audit:read` |
| GET | `/coldchain/:indentId?limit=` | `indent:read` |
| POST | `/demo/reset` | `indent:verify` |

## Errors

```json
{
  "error": { "code": "conflict", "message": "...", "details": { } },
  "requestId": "…"
}
```

`400` validation, `401` no or bad session, `403` wrong role or blocked indent,
`404` unknown resource, `409` wrong state for that transition, `502` the FHIR
server or RxNav did not answer, `500` anything else. In production a `500`
message is replaced with a generic string so implementation detail never
reaches a client.
