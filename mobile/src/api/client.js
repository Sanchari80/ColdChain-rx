import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the API lives.
 *
 * Order of preference:
 *   1. whatever the user typed on the Settings screen
 *   2. EXPO_PUBLIC_API_URL from the environment
 *   3. the machine running Metro, on port 4000 — this is what makes the app
 *      work on a real phone, where "localhost" would point at the phone itself
 *   4. localhost, for the simulator and for web
 */
const DEFAULT_PORT = 4000;

function hostFromExpo() {
  const hostUri = Constants?.expoConfig?.hostUri
    || Constants?.expoGoConfig?.debuggerHost
    || Constants?.manifest2?.extra?.expoGo?.debuggerHost
    || '';
  const host = String(hostUri).split('/')[0].split(':')[0];
  return host && host !== 'localhost' ? host : null;
}

export function defaultBaseUrl() {
  // A published web build is served by the API itself, so it talks to its own origin.
  if (Platform.OS === 'web' && !__DEV__ && typeof window !== 'undefined') return window.location.origin;

  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const lanHost = hostFromExpo();
  if (lanHost) return `http://${lanHost}:${DEFAULT_PORT}`;

  if (Platform.OS === 'android') return `http://10.0.2.2:${DEFAULT_PORT}`;
  return `http://localhost:${DEFAULT_PORT}`;
}

export class ApiError extends Error {
  constructor(message, { status, code, details, requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function createClient({ baseUrl, getToken, onUnauthorized }) {
  let currentBase = baseUrl;

  async function request(path, { method = 'GET', body, timeoutMs = 12000, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort());

    const token = getToken ? getToken() : null;
    let response;
    try {
      response = await fetch(`${currentBase}/api/v1${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new ApiError('The server did not answer in time. Check that it is running and reachable.', { code: 'timeout' });
      }
      throw new ApiError(`Cannot reach ${currentBase}. Check the address on the Settings screen.`, { code: 'network' });
    }
    clearTimeout(timer);

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      if (response.status === 401 && onUnauthorized) onUnauthorized();
      const error = payload && payload.error;
      throw new ApiError(error?.message || `Request failed (${response.status})`, {
        status: response.status,
        code: error?.code,
        details: error?.details,
        requestId: payload?.requestId,
      });
    }
    return payload;
  }

  return {
    get baseUrl() {
      return currentBase;
    },
    setBaseUrl(next) {
      currentBase = String(next || '').replace(/\/+$/, '');
    },
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body: body ?? {} }),
  };
}
