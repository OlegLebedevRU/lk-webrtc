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

// TODO: Replace with real key management (login flow, secure storage, etc.)
const API_KEY = 'pk-panel-6004-a1b2c3d4e5f6';

function authHeaders(): HeadersInit {
  return { 'X-API-Key': API_KEY };
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
