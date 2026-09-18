# ColdChain Rx

Refrigerated medicines from the hospital pharmacy to the patient's bedside, checked
against the doctor's prescription before they leave the pharmacy and temperature-tracked
on the way.

## Live demo

### **https://coldchain-rx.onrender.com**

Open it in any browser, on a phone or a computer. Nothing to install.

> The demo runs on a free server. If it has been idle, the first visit can take
> up to a minute to load. After that it is fast.

## Android app

[**Download the APK**](https://github.com/Sanchari80/ColdChain-rx/releases/download/v1.0.0/ColdChain-Rx-v1.0.0.apk) (71 MB)

Install it on an Android phone and sign in with any account below. Android will ask
you to allow an app from outside the Play Store. Allow notifications when the app
asks: ward alerts then arrive as push notifications, even while the app is closed.

The browser demo above works on iPhone as well.

## Sign in

| Role | Name | Staff ID | PIN |
| --- | --- | --- | --- |
| Pharmacist | Rupom Saha | `PHARM2201` | `8890` |
| Nurse (ward IPD-7B) | Mim Hasan | `NUR9931` | `4417` |
| Nurse (ward IPD-9A) | Farhana Yasmin | `NUR9932` | `2210` |
| Courier | Rakib Mia | `CUR-01` | `3364` |
| Administrator | Sabrina Rahman | `ADM1004` | `7712` |

Staff IDs are not case-sensitive. Tap **Show** in the PIN field to check what you typed.

## Try it in three minutes

Use two browser windows, for example a normal window and a private one, or a phone and a computer.

1. **Window 1: sign in as the nurse** `NUR9931` and allow notifications. Tap **Request medication**,
   choose **Filgrastim** and tap **Send to pharmacy**. The screen shows the request went out as an
   **HL7 v2 OMP^O09** message and came back acknowledged (`ACK AA`).
2. **Window 2: sign in as the pharmacist** `PHARM2201`. The new request is on the list as
   *Awaiting check*. Open it, tap **Check against the prescription** (it passes), pick a courier and
   tap **Pack and dispatch**.
3. **Back in window 1:** the nurse gets a notification with the courier and the arrival time.
   It has no patient name, record number, date of birth or phone number.
4. **As the pharmacist, open IND-2026-0092** and check it. It is blocked: the ward asked for insulin
   glargine **300** units/mL, but the doctor prescribed **100** units/mL.
5. **Open IND-2026-0094.** It is on the way, and its temperature has gone out of range.
6. **Open the Audit tab** to see every action recorded, with a live tamper check at the top.

Everyone using the demo shares the same data. It goes back to the starting state
whenever the server restarts.

## How it meets Case 1

| Requirement | Standard used | Where in the code | Tests |
| --- | --- | --- | --- |
| Nurse submits a request | HL7 v2.5.1 `OMP^O09`, built from the chart | [indentService.js](server/src/services/indents/indentService.js) (`requestFromWard`), [RequestScreen.js](mobile/src/screens/RequestScreen.js) | [request.test.js](server/tests/request.test.js) |
| Read the prescription | HL7 FHIR R4 `MedicationRequest` | [fhirClient.js](server/src/services/fhir/fhirClient.js), [indentService.js](server/src/services/indents/indentService.js) (`verify`) | [api.test.js](server/tests/api.test.js) |
| Validate the drug | RxNorm via NLM RxNav, compared by RxCUI, ingredient, strength and dose form | [rxnormClient.js](server/src/services/rxnorm/rxnormClient.js), [strength.js](server/src/services/rxnorm/strength.js), [refresh-rxnorm.js](server/scripts/refresh-rxnorm.js) | [rxnorm.test.js](server/tests/rxnorm.test.js) |
| Parse the legacy order | HL7 v2 `OMP^O09` with the Redox `hl7-standard` parser | [omp09.js](server/src/services/hl7/omp09.js) | [hl7.test.js](server/tests/hl7.test.js) |
| Update the chart | HL7 FHIR R4 `MedicationDispense` with courier and ETA, plus `Provenance` | [resources.js](server/src/services/fhir/resources.js) | [api.test.js](server/tests/api.test.js) |
| Notify the nurse's phone | Push notifications through Expo and Firebase Cloud Messaging | [push.js](server/src/services/notifications/push.js), [notifications.js](mobile/src/utils/notifications.js) | [push.test.js](server/tests/push.test.js) |
| No PHI in the alert | HIPAA Safe Harbor: allow-list plus a runtime check that blocks any leak | [deidentify.js](server/src/services/phi/deidentify.js) | [phi.test.js](server/tests/phi.test.js) |
| Tamper-proof audit trail | HL7 FHIR R4 `AuditEvent` with a SHA-256 hash chain | [auditService.js](server/src/services/audit/auditService.js) | [audit.test.js](server/tests/audit.test.js) |

The live demo runs the same code against a built-in FHIR store and an RxNorm formulary pulled from
RxNav, so it stays stable for reviewers. The drug codes are real RxCUIs. Setting `DATA_MODE=live`
points the same code at a FHIR server such as `hapi.fhir.org` and calls RxNav directly.
[docs/STANDARDS.md](docs/STANDARDS.md) explains each part in more detail.

## Built with

- **App:** React Native with Expo (Android, iOS and web from one codebase)
- **Server:** Node.js and Express
- **Standards:** HL7 FHIR R4, HL7 v2 (OMP^O09), RxNorm, HIPAA Safe Harbor de-identification

## Run it on your own computer

You need Node.js 18 or newer.

```bash
# Terminal 1: the server
cd server
npm install
npm start
```

```bash
# Terminal 2: the app
cd mobile
npm install
npx expo start
```

Press `w` to open it in the browser, or scan the QR code with the
[Expo Go](https://expo.dev/go) app (phone and computer on the same Wi-Fi).
