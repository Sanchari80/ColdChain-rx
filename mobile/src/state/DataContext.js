import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { notifyAlert, prepareNotifications, setBadge } from '../utils/notifications';

const DataContext = createContext(null);

const REFRESH_MS = 6000;

/**
 * Keeps indents, alerts and audit entries fresh.
 *
 * Polling rather than the server's SSE stream: React Native has no EventSource,
 * and a six-second poll over a hospital wifi that drops constantly is more
 * predictable than a long-lived connection the OS will kill in the background.
 *
 * Every alert the feed brings in after the first load raises a notification on
 * the device. Polling carries on while the app is in the background for as long
 * as the OS lets it run, so a minimised app still hears about a delivery.
 */
export function DataProvider({ children }) {
  const { client, user, can } = useAuth();
  const [indents, setIndents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [unread, setUnread] = useState(0);
  const [audit, setAudit] = useState({ entries: [], integrity: null });
  const [capabilities, setCapabilities] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const appState = useRef(AppState.currentState);
  const busy = useRef(false);
  // Alert ids already seen, so a notification is raised once per alert. The
  // first load only fills this in: nobody wants the whole backlog on sign-in.
  const seenAlerts = useRef(new Set());
  const seeded = useRef(false);
  // Indents this person just acted on, with when to stop keeping quiet about them.
  const ownActions = useRef(new Map());

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!user || busy.current) return;
    busy.current = true;
    if (!quiet) setLoading(true);
    try {
      const [indentResult, alertResult] = await Promise.all([
        client.get('/indents'),
        // A role without the alerts permission never asks for them.
        can('notification:read') ? client.get('/notifications') : Promise.resolve({ items: [], unread: 0 }),
      ]);
      setIndents(indentResult.items || []);
      const items = alertResult.items || [];
      const fresh = items.filter((item) => !seenAlerts.current.has(item.id));
      fresh.forEach((item) => seenAlerts.current.add(item.id));
      if (seeded.current) {
        const now = Date.now();
        // Oldest first, so they stack in the order they happened. Alerts this
        // person just caused are not news to them.
        fresh
          .slice()
          .reverse()
          .filter((item) => !item.read && !((ownActions.current.get(item.indentId) || 0) > now))
          .forEach((item) => notifyAlert(item));
      }
      seeded.current = true;
      setAlerts(items);
      setUnread(alertResult.unread || 0);
      setBadge(alertResult.unread || 0);
      setLastError(null);
      setLastSyncedAt(new Date().toISOString());
    } catch (err) {
      setLastError(err.message);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [client, user, can]);

  const refreshAudit = useCallback(async () => {
    if (!user || !can('audit:read')) return;
    try {
      const result = await client.get('/audit?limit=60');
      setAudit({ entries: result.entries || [], integrity: result.integrity || null });
    } catch (err) {
      setLastError(err.message);
    }
  }, [client, user, can]);

  // A different person on the device starts with a clean slate.
  const userId = user ? user.id : null;
  useEffect(() => {
    seenAlerts.current = new Set();
    seeded.current = false;
    ownActions.current = new Map();
  }, [userId]);

  useEffect(() => {
    if (!user) {
      setIndents([]);
      setAlerts([]);
      setAudit({ entries: [], integrity: null });
      setBadge(0);
      return undefined;
    }
    if (can('notification:read')) prepareNotifications();
    refresh();
    refreshAudit();
    client.get('/capabilities').then(setCapabilities).catch(() => {});

    const timer = setInterval(() => refresh({ quiet: true }), REFRESH_MS);

    const subscription = AppState.addEventListener('change', (next) => {
      const wasBackground = appState.current !== 'active';
      appState.current = next;
      if (next === 'active' && wasBackground) refresh({ quiet: true });
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [user, refresh, refreshAudit, client, can]);

  const getIndent = useCallback((id) => indents.find((item) => item.id === id) || null, [indents]);

  const act = useCallback(async (path, body) => {
    const own = /^\/indents\/([^/]+)\//.exec(path);
    if (own) ownActions.current.set(own[1], Date.now() + 30000);
    const result = await client.post(path, body);
    await refresh({ quiet: true });
    refreshAudit();
    return result;
  }, [client, refresh, refreshAudit]);

  const value = useMemo(() => ({
    indents,
    alerts,
    unread,
    audit,
    capabilities,
    loading,
    lastError,
    lastSyncedAt,
    refresh,
    refreshAudit,
    getIndent,
    verify: (id) => act(`/indents/${id}/verify`),
    dispense: (id, body) => act(`/indents/${id}/dispense`, body),
    receive: (id, body) => act(`/indents/${id}/receive`, body),
    cancel: (id, reason) => act(`/indents/${id}/cancel`, { reason }),
    ingestHl7: (message) => act('/hl7/ingest', { message }),
    restoreBaseline: () => act('/system/restore-baseline'),
    loadOrderTemplates: () => client.get('/hl7/templates'),
    loadDirectory: () => client.get('/directory'),
    provisionAccount: (body) => client.post('/directory', body),
    setAccountStatus: (id, status) => client.post(`/directory/${id}/status`, { status }),
    reissuePin: (id) => client.post(`/directory/${id}/pin-reset`),
    loadTelemetry: (id) => client.get(`/coldchain/${id}`),
    markAlertsRead: async () => {
      try {
        await client.post('/notifications/read-all');
        setUnread(0);
        setBadge(0);
        setAlerts((current) => current.map((item) => ({ ...item, read: true })));
      } catch {
        // A failed read receipt is not worth interrupting anyone over.
      }
    },
  }), [indents, alerts, unread, audit, capabilities, loading, lastError, lastSyncedAt, refresh, refreshAudit, getIndent, act, client]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside DataProvider');
  return value;
}
