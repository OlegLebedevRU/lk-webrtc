import type { SipCredentials } from '../types/sip.types.ts';

export interface AppConfig {
  janusServer: string | string[];
  iceServers: RTCIceServer[] | null;
}

const API_BASE = 'https://d5deskhogog1nujgihou.uvah0e6r.apigw.yandexcloud.net';

/**
 * Fetches Janus server configuration from API Gateway.
 */
export async function getJanusConfig(): Promise<AppConfig> {
  const resp = await fetch(`${API_BASE}/api/janus-config-wss`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Janus config: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

/**
 * Fetches SIP credentials from API Gateway.
 * TODO: Add authentication when moving to production.
 */
export async function getSipCredentials(): Promise<SipCredentials> {
  const resp = await fetch(`${API_BASE}/api/sip-credentials`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch SIP credentials: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}
