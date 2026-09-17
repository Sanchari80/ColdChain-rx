# ColdChain Rx

Refrigerated medicines from the hospital pharmacy to the patient's bedside, checked
against the doctor's prescription before they leave the pharmacy and temperature-tracked
on the way.

## Live demo

### **https://coldchain-rx.onrender.com**

Open it in any browser, on a phone or a computer. Nothing to install.

> The demo runs on a free server that sleeps when nobody is using it. The first
> visit can take up to a minute to load. After that it is fast.

## Sign in

| Role | Name | Staff ID | PIN |
| --- | --- | --- | --- |
| Pharmacist | Rupom Saha | `PHARM2201` | `8890` |
| Nurse (ward IPD-7B) | Mim Hasan | `NUR9931` | `4417` |
| Nurse (ward IPD-9A) | Farhana Yasmin | `NUR9932` | `2210` |
| Courier | Rakib Mia | `CUR-01` | `3364` |
| Administrator | Sabrina Rahman | `ADM1004` | `7712` |

Staff IDs are not case-sensitive. Tap **Show** in the PIN field to check what you typed.

## Try it in two minutes

1. Sign in as the **pharmacist**.
2. Open **IND-2026-0092** and tap **Check against the prescription**. It is blocked:
   the ward asked for a different strength than the doctor prescribed.
3. Open **IND-2026-0091**, check it, pick a courier and tap **Pack and dispatch**.
4. On a second device, or in a private browser window, sign in as the **nurse** `NUR9931`
   and allow notifications. Dispatch from the pharmacist and the nurse gets an alert
   with the courier, the arrival time and the live temperature, but no patient details.
5. Open **IND-2026-0094**. It is on the way and its temperature has gone out of range.
6. Open the **Audit** tab to see every action recorded.

Everyone using the demo shares the same data. It goes back to the starting state
whenever the server restarts.

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
