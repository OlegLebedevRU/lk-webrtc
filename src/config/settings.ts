import type { SipCredentials } from '../types/sip.types.ts';

export interface AppConfig {
  janusServer: string | string[];
  iceServers: RTCIceServer[] | null;
}

export interface AccountInfo {
  id: string;
  name: string;
}

const API_BASE = 'https://d5deskhogog1nujgihou.uvah0e6r.apigw.yandexcloud.net';
const API_KEY_STORAGE_KEY = 'lk-webrtc-api-key';

export function getApiKey(): string | null {
  const key = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (!key || key.trim() === '') {
    return null;
  }
  return key;
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

function authHeaders(): HeadersInit {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API key not set. Please enter your PIN code.');
  }
  return { 'X-API-Key': apiKey };
}

/**
 * Fetches Janus server configuration (public, no auth required).
 */
export async function getJanusConfig(): Promise<AppConfig> {
  const resp = await fetch(`${API_BASE}/api/janus-config-wss`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Janus config: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

/**
 * Fetches SIP credentials (requires API key).
 */
export async function getSipCredentials(): Promise<SipCredentials> {
  const resp = await fetch(`${API_BASE}/api/sip-credentials`, {
    headers: authHeaders(),
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch SIP credentials: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

/**
 * Fetches account info (requires API key).
 */
export async function getAccountInfo(): Promise<AccountInfo> {
  const resp = await fetch(`${API_BASE}/api/account`, {
    headers: authHeaders(),
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch account info: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}
