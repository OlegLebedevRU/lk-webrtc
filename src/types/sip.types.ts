/**
 * TypeScript type definitions for Janus SIP Plugin.
 */

export interface SipCredentials {
  username: string;
  authuser: string;
  displayName: string;
  proxy: string;
  secret: string;
}

export type SipRegistrationType = 'guest' | 'default';

export interface SipRegisterRequest {
  [key: string]: unknown;
  request: 'register';
  username: string;
  authuser?: string;
  display_name?: string;
  proxy?: string;
  secret?: string;
  ha1_secret?: string;
  refresh?: boolean;
  type?: SipRegistrationType;
}

export interface SipCallRequest {
  [key: string]: unknown;
  request: 'call';
  uri: string;
  autoaccept_reinvites?: boolean;
  srtp?: 'sdes_optional' | 'sdes_mandatory';
  video?: boolean;
  offerless?: boolean;
}

export interface SipAcceptRequest {
  [key: string]: unknown;
  request: 'accept';
  srtp?: 'sdes_optional' | 'sdes_mandatory';
  video?: boolean;
}

export interface SipHangupRequest {
  [key: string]: unknown;
  request: 'hangup';
}

export interface SipDeclineRequest {
  [key: string]: unknown;
  request: 'decline';
  code?: number;
}

export interface SipHoldRequest {
  [key: string]: unknown;
  request: 'hold' | 'unhold';
}

export interface SipTransferRequest {
  [key: string]: unknown;
  request: 'transfer';
  uri: string;
  replace?: string;
}

export interface SipDtmfRequest {
  [key: string]: unknown;
  request: 'dtmf_info';
  digit: string;
}

export interface SipMessageRequest {
  [key: string]: unknown;
  request: 'message';
  content: string;
  content_type?: string;
  uri?: string;
}

export type SipEvent =
  | 'registered'
  | 'registration_failed'
  | 'calling'
  | 'incomingcall'
  | 'accepting'
  | 'progress'
  | 'accepted'
  | 'updatingcall'
  | 'message'
  | 'info'
  | 'notify'
  | 'transfer'
  | 'hangup'
  | 'messagedelivery';

export interface SipEventResult {
  event: SipEvent;
  result?: {
    code?: number;
    reason?: string;
    username?: string;
    displayname?: string;
    callee?: string;
    caller?: string;
    call_id?: string;
    master_id?: number;
    content?: string;
    content_type?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
  error?: string;
  error_code?: number;
}

export interface SipHelperState {
  registered: boolean;
  callId: string | null;
  masterId: number | null;
  inCall: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
}
