/**
 * Main entry point — re-exports all public classes, functions, and types.
 */

// Core
export { JanusClient } from './core/JanusClient.ts';
export type { JanusClientCallbacks } from './core/JanusClient.ts';

// Plugins
export { SipPlugin } from './plugins/SipPlugin.ts';
export type { SipPluginCallbacks } from './plugins/SipPlugin.ts';

export { StreamingPlugin } from './plugins/StreamingPlugin.ts';
export type { StreamingPluginCallbacks } from './plugins/StreamingPlugin.ts';

// Config
export {
  getJanusConfig,
  getSipCredentials,
  getAccountInfo,
  getApiKey,
  setApiKey,
  clearApiKey,
} from './config/settings.ts';
export type { AppConfig, AccountInfo } from './config/settings.ts';

// Utils
export { escapeXmlTags, generateOpaqueId, debounce, safeJsonParse, isObject } from './utils/helpers.ts';

// Types
export type {
  JanusInitOptions,
  JanusConstructorOptions,
  JanusTrackOption,
  JanusTrackInfo,
  JanusMediaConstraints,
  JanusTrackMetadata,
  JanusJsep,
  JanusMessage,
  JanusPluginHandle,
  JanusPluginCallbacks,
  JanusInstance,
  JanusStatic,
} from './types/janus.d.ts';

export type {
  SipCredentials,
  SipRegistrationType,
  SipRegisterRequest,
  SipCallRequest,
  SipAcceptRequest,
  SipHangupRequest,
  SipDeclineRequest,
  SipHoldRequest,
  SipTransferRequest,
  SipDtmfRequest,
  SipMessageRequest,
  SipEvent,
  SipEventResult,
  SipHelperState,
} from './types/sip.types.ts';

export type {
  StreamMedia,
  StreamInfo,
  StreamingListRequest,
  StreamingInfoRequest,
  StreamingWatchRequest,
  StreamingStartRequest,
  StreamingStopRequest,
  StreamingPauseRequest,
  StreamingConfigureRequest,
  StreamingSwitchRequest,
  StreamingListResult,
  StreamingStatus,
} from './types/streaming.types.ts';
