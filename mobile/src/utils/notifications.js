import { LogBox, Platform } from 'react-native';

/**
 * Ward alerts on the device's own notification shade.
 *
 * These are local notifications raised by the app when the alert feed brings in
 * something new, so they work in Expo Go on Android and iOS without a push
 * service. On web the browser's Notification API is used instead.
 */

// Expo Go prints a notice about remote push on import. Remote push is not used.
LogBox.ignoreLogs(['`expo-notifications` functionality is not fully supported']);

const isWeb = Platform.OS === 'web';
const Notifications = isWeb ? null : require('expo-notifications');

export const CHANNEL_ID = 'ward-alerts';

if (Notifications) {
  // Show the banner and play the sound even while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

let prepared = null;

/** Creates the Android channel and asks for permission. Safe to call repeatedly. */
export function prepareNotifications() {
  if (prepared) return prepared;
  prepared = (async () => {
    try {
      if (isWeb) {
        if (typeof window === 'undefined' || !('Notification' in window)) return false;
        if (window.Notification.permission === 'granted') return true;
        if (window.Notification.permission === 'denied') return false;
        return (await window.Notification.requestPermission()) === 'granted';
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
          name: 'Ward alerts',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 150, 250],
          lightColor: '#19D3A2',
          sound: 'default',
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }

      const current = await Notifications.getPermissionsAsync();
      if (current.granted) return true;
      if (!current.canAskAgain) return false;
      const asked = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: true },
      });
      return Boolean(asked.granted);
    } catch {
      return false;
    }
  })();
  // A refusal can be reversed in system settings, so ask again next time.
  prepared.then((granted) => { if (!granted) prepared = null; });
  return prepared;
}

/** Words for an alert, in the same terms the Alerts screen uses. */
export function describeAlert(alert) {
  const place = [alert.ward, alert.bed].filter(Boolean).join(' · ');
  const courier = alert.courier && alert.courier.staffName;
  const temp = alert.coldChain && typeof alert.coldChain.currentCelsius === 'number'
    ? `${alert.coldChain.currentCelsius.toFixed(1)}°C`
    : null;

  switch (alert.status) {
    case 'in-transit':
      return {
        title: `On the way: ${alert.drug}`,
        body: [place, courier ? `with ${courier}` : null, alert.coldChain && alert.coldChain.breached ? `out of range ${temp}` : temp]
          .filter(Boolean).join(' · '),
      };
    case 'blocked':
      return { title: `Blocked: ${alert.drug}`, body: [place, 'Stopped at the pharmacy safety check'].filter(Boolean).join(' · ') };
    case 'delivered-quarantine':
      return { title: `Quarantined: ${alert.drug}`, body: [place, `Temperature excursion ${temp || ''}`.trim()].filter(Boolean).join(' · ') };
    case 'delivered':
      return { title: `Delivered: ${alert.drug}`, body: [place, courier ? `Received from ${courier}` : null].filter(Boolean).join(' · ') };
    default:
      return { title: alert.drug || 'Ward alert', body: place };
  }
}

/** Raises one notification for a ward alert. */
export async function notifyAlert(alert) {
  const granted = await prepareNotifications();
  if (!granted) return;
  const { title, body } = describeAlert(alert);
  const critical = alert.severity === 'critical';

  try {
    if (isWeb) {
      const note = new window.Notification(title, { body, tag: alert.id });
      note.onclick = () => window.focus();
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: { indentId: alert.indentId, alertId: alert.id },
        ...(Platform.OS === 'android'
          ? { priority: critical ? Notifications.AndroidNotificationPriority.MAX : Notifications.AndroidNotificationPriority.HIGH, color: critical ? '#FF6058' : '#19D3A2' }
          : { interruptionLevel: critical ? 'timeSensitive' : 'active' }),
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    // A notification that cannot be shown must never break the alert feed.
  }
}

/** Keeps the app icon badge in step with the unread count. */
export function setBadge(count) {
  if (!Notifications) return;
  Notifications.setBadgeCountAsync(Math.max(0, count || 0)).catch(() => {});
}

/** Calls back with the indent id whenever someone taps one of our notifications. */
export function onNotificationOpened(callback) {
  if (!Notifications) return () => {};
  const handle = (response) => {
    const data = response && response.notification && response.notification.request.content.data;
    if (data && data.indentId) callback(data.indentId);
  };
  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) {
      handle(response);
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    }
  }).catch(() => {});
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
