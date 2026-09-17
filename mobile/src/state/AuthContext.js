import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { createClient, defaultBaseUrl } from '../api/client';
import { currentPushToken } from '../utils/notifications';

const AuthContext = createContext(null);

/**
 * The session, for as long as the app is open.
 *
 * Two ways in, neither of which can create an account: the staff ID and PIN the
 * hospital issued, or the hospital's own single sign-on where the facility runs
 * it. What the service answers with decides what the app offers, so a site that
 * has not connected an identity provider never sees a button for one.
 *
 * The token deliberately never touches persistent storage. On a shared ward
 * device, a session that survives the app being closed is a session the next
 * person inherits. Signing in again takes four seconds.
 */
export function AuthProvider({ children }) {
  const tokenRef = useRef(null);
  const [user, setUser] = useState(null);
  const [baseUrl, setBaseUrlState] = useState(defaultBaseUrl());
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState(null);
  const [access, setAccess] = useState(null);
  const [accessError, setAccessError] = useState(null);
  const [loadingAccess, setLoadingAccess] = useState(true);

  const client = useMemo(() => createClient({
    baseUrl,
    getToken: () => tokenRef.current,
    onUnauthorized: () => {
      tokenRef.current = null;
      setUser(null);
    },
  }), [baseUrl]);

  /** What this facility allows, read before anyone has signed in. */
  // A hosted server that has been idle can take close to a minute to wake, so
  // the first contact waits that long and tries again before reporting a fault.
  const loadAccess = useCallback(async () => {
    setLoadingAccess(true);
    setAccessError(null);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await client.get('/auth/methods', { timeoutMs: 60000 });
        setAccess(result);
        setAccessError(null);
        setLoadingAccess(false);
        return result;
      } catch (err) {
        lastError = err;
        if (err.status) break; // The server answered; waiting will not change it.
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    setAccess(null);
    setAccessError(lastError ? lastError.message : 'Cannot reach the server.');
    setLoadingAccess(false);
    return null;
  }, [client]);

  useEffect(() => {
    loadAccess();
  }, [loadAccess]);

  const signIn = useCallback(async (staffId, pin) => {
    setSigningIn(true);
    setError(null);
    try {
      const result = await client.post(
        '/auth/login',
        { staffId: String(staffId).trim(), pin: String(pin).trim() },
        { timeoutMs: 60000 },
      );
      tokenRef.current = result.token;
      setUser(result.user);
      return result.user;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSigningIn(false);
    }
  }, [client]);

  /**
   * Hands the person to the hospital identity provider.
   *
   * The device only ever carries the authorization code back; the code is
   * exchanged server-side, and the account still has to exist in the staff
   * directory before a session is issued.
   */
  const startSingleSignOn = useCallback(async () => {
    setError(null);
    try {
      const result = await client.post('/auth/sso/start', {});
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.assign(result.authorizationUrl);
      } else {
        await Linking.openURL(result.authorizationUrl);
      }
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [client]);

  const completeSingleSignOn = useCallback(async ({ code, state }) => {
    setSigningIn(true);
    setError(null);
    try {
      const result = await client.post('/auth/sso/complete', { code, state });
      tokenRef.current = result.token;
      setUser(result.user);
      return result.user;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSigningIn(false);
    }
  }, [client]);

  const changePin = useCallback(async (currentPin, newPin) => {
    const result = await client.post('/auth/pin', { currentPin, newPin });
    setUser((current) => (current ? { ...current, mustChangePin: false } : current));
    return result.account;
  }, [client]);

  const signOut = useCallback(() => {
    // This phone stops receiving pushes for the person signing out.
    const pushToken = currentPushToken();
    if (pushToken && tokenRef.current) client.post('/notifications/devices/remove', { token: pushToken }).catch(() => {});
    tokenRef.current = null;
    setUser(null);
    setError(null);
  }, [client]);

  const setBaseUrl = useCallback((next) => {
    const cleaned = String(next || '').trim().replace(/\/+$/, '');
    setBaseUrlState(cleaned);
    tokenRef.current = null;
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user,
    client,
    baseUrl,
    setBaseUrl,
    signIn,
    signOut,
    signingIn,
    error,
    clearError: () => setError(null),
    access,
    accessError,
    loadingAccess,
    loadAccess,
    startSingleSignOn,
    completeSingleSignOn,
    changePin,
    can: (scope) => Boolean(user && user.scopes && user.scopes.includes(scope)),
  }), [
    user, client, baseUrl, setBaseUrl, signIn, signOut, signingIn, error,
    access, accessError, loadingAccess, loadAccess, startSingleSignOn, completeSingleSignOn, changePin,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
