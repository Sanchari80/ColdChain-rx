'use strict';

const config = require('../../config');
const logger = require('../../util/logger');

/**
 * Push delivery of ward alerts to phones, including phones where the app is
 * closed.
 *
 * Devices register the Expo push token they were issued when a member of staff
 * signs in. Alerts go through the Expo push service, which hands them to
 * Firebase Cloud Messaging on Android and APNs on iOS. Only the de-identified
 * alert text is sent: it has already passed the PHI guard before it gets here.
 *
 * Registrations live in memory. A phone registers again every time someone
 * signs in on it and while the app is running, so a restart heals itself.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN_PATTERN = /^Expo(nent)?PushToken\[[^\]]+\]$/;
const CHUNK = 100;

const devices = new Map();
let transport = defaultTransport;
let paused = false;

function isValidToken(token) {
  return TOKEN_PATTERN.test(String(token || ''));
}

/** Binds a device to whoever just signed in on it. The last sign-in wins. */
function register({ token, platform }, actor) {
  const device = {
    token,
    platform: platform || 'unknown',
    staffId: actor.id,
    role: actor.role,
    ward: actor.ward || null,
    registeredAt: new Date().toISOString(),
  };
  devices.set(token, device);
  return device;
}

/** Signing out stops alerts for that person on that device. */
function unregister(token, actor) {
  const device = devices.get(token);
  if (!device || (actor && device.staffId !== actor.id)) return false;
  devices.delete(token);
  return true;
}

/** The same rule the alert feed uses: ward staff hear about their ward, everyone else hears everything. */
function recipientsFor(alert, { excludeStaffId } = {}) {
  return [...devices.values()].filter((device) => (
    device.staffId !== excludeStaffId && (!device.ward || device.ward === alert.ward)
  ));
}

/** Words for an alert, in the same terms the app uses. */
function describe(alert) {
  const place = [alert.ward, alert.bed].filter(Boolean).join(' · ');
  const courier = alert.courier && alert.courier.staffName;
  const current = alert.coldChain && typeof alert.coldChain.currentCelsius === 'number'
    ? `${alert.coldChain.currentCelsius.toFixed(1)}°C`
    : null;
  const breached = Boolean(alert.coldChain && alert.coldChain.breached);

  switch (alert.status) {
    case 'in-transit':
      return {
        title: `On the way: ${alert.drug}`,
        body: [place, courier ? `with ${courier}` : null, breached ? `out of range ${current}` : current].filter(Boolean).join(' · '),
      };
    case 'requested':
      return { title: `Requested: ${alert.drug}`, body: [place, 'Waiting for the pharmacist'].filter(Boolean).join(' · ') };
    case 'blocked':
      return { title: `Blocked: ${alert.drug}`, body: [place, 'Stopped at the pharmacy safety check'].filter(Boolean).join(' · ') };
    case 'delivered-quarantine':
      return { title: `Quarantined: ${alert.drug}`, body: [place, `Temperature excursion ${current || ''}`.trim()].filter(Boolean).join(' · ') };
    case 'delivered':
      return { title: `Delivered: ${alert.drug}`, body: [place, courier ? `Received from ${courier}` : null].filter(Boolean).join(' · ') };
    default:
      return { title: alert.drug || 'Ward alert', body: place };
  }
}

function messageFor(alert, device) {
  const { title, body } = describe(alert);
  return {
    to: device.token,
    title,
    body,
    sound: 'default',
    priority: 'high',
    channelId: 'ward-alerts',
    ttl: 60 * 60,
    data: { indentId: alert.indentId, alertId: alert.id },
  };
}

async function defaultTransport(messages) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (config.push.accessToken) headers.Authorization = `Bearer ${config.push.accessToken}`;
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Expo push service returned ${response.status}`);
  }
  return payload.data || [];
}

/**
 * Sends one alert to every device that should hear about it.
 * Never throws: a push that fails must not undo the dispense that caused it.
 */
async function sendAlert(alert, { excludeStaffId } = {}) {
  if (!config.push.enabled || paused) return { sent: 0 };
  const recipients = recipientsFor(alert, { excludeStaffId });
  if (!recipients.length) return { sent: 0 };

  let sent = 0;
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const batch = recipients.slice(i, i + CHUNK);
    try {
      const tickets = await transport(batch.map((device) => messageFor(alert, device)));
      tickets.forEach((ticket, index) => {
        if (ticket && ticket.status === 'ok') {
          sent += 1;
          return;
        }
        const reason = ticket && ticket.details && ticket.details.error;
        // The app was uninstalled or the token rotated: stop sending to it.
        if (reason === 'DeviceNotRegistered') devices.delete(batch[index].token);
        logger.warn('push.ticket.failed', { alertId: alert.id, reason: reason || (ticket && ticket.message) || 'unknown' });
      });
    } catch (err) {
      logger.warn('push.send.failed', { alertId: alert.id, reason: err.message });
    }
  }
  logger.info('push.sent', { alertId: alert.id, recipients: recipients.length, sent });
  return { sent };
}

/** Runs `work` without sending pushes, e.g. while the demo baseline is rebuilt. */
async function withoutPush(work) {
  paused = true;
  try {
    return await work();
  } finally {
    paused = false;
  }
}

module.exports = {
  isValidToken,
  register,
  unregister,
  recipientsFor,
  describe,
  sendAlert,
  withoutPush,
  deviceCount: () => devices.size,
  // Test seams.
  _setTransport: (fn) => { transport = fn || defaultTransport; },
  _reset: () => { devices.clear(); paused = false; },
};
