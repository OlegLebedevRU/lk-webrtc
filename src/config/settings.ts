import type { SipCredentials } from '../types/sip.types.ts';

export interface AppConfig {
  janusServer: string | string[];
  iceServers: RTCIceServer[] | null;
}

/**
 * Returns the Janus server configuration based on the current page protocol.
 * TODO: Replace with an API call to fetch configuration from backend.
 */
export function getJanusConfig(): AppConfig {
  const isHttps =
    typeof window !== 'undefined' && window.location.protocol === 'https:';

  const janusServer: string | string[] = isHttps
    ? ['wss://iot.leo4.ru:8989']
    : 'http://iot.leo4.ru:8088/janus';

  return {
    janusServer,
    iceServers: null,
  };
}

/**
 * Returns SIP credentials for the panel device.
 * TODO: Replace with an API call to fetch credentials from backend.
 */
export async function getSipCredentials(): Promise<SipCredentials> {
  return {
    username: 'sip:6004@87.242.100.34',
    authuser: '6004',
    displayName: 'Panel N 6004',
    proxy: 'sip:87.242.100.34:5060',
    secret: '6004',
  };
}
