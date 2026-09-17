# Where each standard is actually used

The brief listed five things to build. This is where each one lives and how the
common "novice" shortcut was avoided.

## 1. Read the prescription — FHIR R4 MedicationRequest

`server/src/services/fhir/fhirClient.js`, `services/indents/indentService.js`

`GET MedicationRequest/{id}` before anything is packed. The order is checked for
four things, in this order: it is still `active`, its `subject` is the patient in
that bed, its `dispenseRequest.validityPeriod` has not closed, and its
`medicationCodeableConcept` matches what the ward asked for.

A stopped order is one of the four demo indents, because a safety gate that has
never been seen to block anything has not been tested.

## 2. Validate the drug — RxNorm via NLM RxNav

`server/src/services/rxnorm/rxnormClient.js`

Comparison is by RxCUI, and when the codes differ the ingredient sets are
compared, not the names. The verdict is one of three, because "different code,
same product" and "different drug" are different problems for a pharmacist:

| Verdict | When | What the app does |
| --- | --- | --- |
| `pass` | same RxCUI | dispense allowed |
| `review` | same ingredients, different dose form, or a stale code | dispense needs a written pharmacist override |
| `fail` | different ingredient, different strength, or unresolvable | dispense refused, `403` |

There is no `name.includes('Insulin')` anywhere in this repository. `Lantus` and
`Insulin Glargine 100 UNT/ML Injectable Solution` resolve to the same concept,
which no amount of string matching would tell you.

In `DATA_MODE=live` every lookup goes to the NLM RxNav REST API. In
`DATA_MODE=mock` the same code reads `snapshot.json`, which holds real RxNorm
concepts pulled from RxNav by `npm run rxnorm:refresh`: real RxCUIs, ingredients,
dose forms and brand names. Strength comes from each product's SCDC components
(`insulin glargine 300 UNT/ML`), not from its display name. Settings shows which
source is in use and when the snapshot was pulled.

## 3. Parse the legacy message — HL7 v2.5.1 OMP^O09

`server/src/services/hl7/omp09.js`, tests in `server/tests/hl7.test.js`

Parsing uses the Redox `hl7-standard` library. Hand-splitting on `|` and `\r`
looks like it works right up until a message arrives with repeating fields,
escaped delimiters (`\F\`, `\S\`, `\T\`), non-default encoding characters in
MSH-2, or segments in an unexpected order — and then it silently mis-reads a
drug name rather than failing.

The parser rejects a message that is not OMP^O09, one with no ORC, one with no
RXO, and one with no MSH-10, and it answers every message with an ACK^O09.

A nurse's request from the app takes the same road. `requestFromWard` in
`services/indents/indentService.js` reads the prescription, patient and
encounter from FHIR, writes an OMP^O09 (free text escaped with `F`, `S`,
`T`, `R`, `E`), and passes it to the same parser and the same
`upsertFromHl7` as a message from the interface engine. The ward device gets
back the segment list and the ACK, never the message, so the PID it carried
stays on the server.

## 4. Update the chart — FHIR R4 MedicationDispense

`server/src/services/fhir/resources.js`

Written when the pharmacy packs the product, referencing the authorising
`MedicationRequest`. Cold-chain custody is not in base R4, so courier, ETA and
the permitted temperature range are modelled as named extensions rather than
buried in a free-text note where no downstream system could read them. A
`Provenance` resource is written alongside.

On handover the dispense is set to `completed`, or to `on-hold` if the product
left the 2-8 window in transit.

## 5. HIPAA — de-identification and the audit trail

`server/src/services/phi/deidentify.js`, `services/audit/auditService.js`

The ward alert is built from a whitelist of operational fields and then
re-inspected before it is published. `assertNoPhi` compares the finished payload
against the identifiers the server actually holds for that patient and throws if
any of them survived. A change that adds a patient name to an alert fails a test
instead of quietly leaking; that guard caught a real leak during development,
where a courier's `name` key was travelling in the payload.

What the nurse gets instead: ward, bed, product, dose, courier name, ETA, live
temperature, and a stable `SUBJ-XXXXXXXXXX` pseudonym (HMAC-SHA256 of the patient
id under a deployment salt) so two alerts about the same patient can be
correlated on the device without identifying anyone.

Every read of a chart and every write back produces a FHIR `AuditEvent`. On top
of that the server keeps a hash chain: entry N stores SHA-256 of (hash of entry
N-1 + canonical JSON of entry N). Editing or deleting any entry breaks every
hash after it, so tampering is detectable even by someone with write access.
`GET /api/v1/audit/integrity` recomputes the whole chain.

## Against the brief's red flags

| Red flag | This project |
| --- | --- |
| `if (name.includes("Blood Pressure"))` | RxCUI and ingredient-set comparison; LOINC code `8329-5` on the OBX temperature reading |
| regex or `split('\r')` for HL7 | Redox `hl7-standard`, with tests for repeats, CRLF and escape sequences |
| tokens in `localStorage`, hard-coded ids | session in memory only, never persisted; signed token verified with a constant-time compare; role scopes come from the token, never from the client |
| PHI left in alert payloads | whitelist construction plus a runtime guard that blocks publishing, and `AuditEvent` records for everything |

## Not built, and why

SMART on FHIR PKCE is stubbed. The real flow needs a registered client and an
authorization server to talk to; the token shape, the way it is carried and the
way it is verified are the same, so swapping in a JWKS verifier touches one
file, `server/src/middleware/auth.js`. That file says so at the top rather than
pretending otherwise.
