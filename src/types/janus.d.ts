/**
 * TypeScript type definitions for the Janus WebRTC Gateway JavaScript library.
 */

export interface JanusInitOptions {
  debug?: boolean | 'all' | string[];
  callback?: () => void;
  dependencies?: unknown;
}

export interface JanusConstructorOptions {
  server: string | string[];
  iceServers?: RTCIceServer[] | null;
  ipv6?: boolean;
  withCredentials?: boolean;
  max_poll_events?: number;
  destroyOnUnload?: boolean;
  token?: string;
  apisecret?: string;
  success?: () => void;
  error?: (cause: string) => void;
  destroyed?: () => void;
}

export interface JanusTrackOption {
  type: 'audio' | 'video' | 'data' | 'screen';
  capture?: boolean | MediaTrackConstraints;
  recv?: boolean;
  mid?: string;
  add?: boolean;
  remove?: boolean;
  replace?: boolean;
  simulcast?: boolean;
  svc?: boolean;
  dontStop?: boolean;
}

export interface JanusTrackInfo {
  track: MediaStreamTrack;
  mid: string;
  on: boolean;
}

export interface JanusMediaConstraints {
  audio?: boolean | MediaTrackConstraints;
  video?: boolean | MediaTrackConstraints;
  data?: boolean;
}

export interface JanusTrackMetadata {
  mid: string;
  codec?: string;
  kind?: string;
  label?: string;
  disabled?: boolean;
}

export interface JanusJsep {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface JanusMessage {
  [key: string]: unknown;
}

export interface JanusPluginHandle {
  getId(): number;
  getPlugin(): string;
  send(options: { message: Record<string, unknown>; jsep?: JanusJsep }): void;
  createOffer(options: {
    tracks?: JanusTrackOption[];
    media?: JanusMediaConstraints;
    trickle?: boolean;
    success: (jsep: JanusJsep) => void;
    error: (error: Error) => void;
    customizeSdp?: (jsep: JanusJsep) => void;
  }): void;
  createAnswer(options: {
    jsep: JanusJsep;
    tracks?: JanusTrackOption[];
    media?: JanusMediaConstraints;
    trickle?: boolean;
    success: (jsep: JanusJsep) => void;
    error: (error: Error) => void;
    customizeSdp?: (jsep: JanusJsep) => void;
  }): void;
  handleRemoteJsep(options: { jsep: JanusJsep }): void;
  dtmf(options: { dtmf: { tones: string; duration?: number; gap?: number } }): void;
  getBitrate(mid?: string): string;
  hangup(sendRequest?: boolean): void;
  detach(options?: { success?: () => void; error?: (error: string) => void; noRequest?: boolean }): void;
  muteAudio(mid?: string): boolean;
  unmuteAudio(mid?: string): boolean;
  isAudioMuted(mid?: string): boolean;
  muteVideo(mid?: string): boolean;
  unmuteVideo(mid?: string): boolean;
  isVideoMuted(mid?: string): boolean;
  webrtcStuff?: {
    started: boolean;
    myStream?: MediaStream;
    streamExternal?: boolean;
    remoteStream?: MediaStream;
    pc?: RTCPeerConnection;
    [key: string]: unknown;
  };
}

export interface JanusPluginCallbacks {
  plugin: string;
  opaqueId?: string;
  success: (handle: JanusPluginHandle) => void;
  error: (cause: string) => void;
  consentDialog?: (on: boolean) => void;
  iceState?: (state: RTCIceConnectionState) => void;
  mediaState?: (medium: string, on: boolean, mid?: string) => void;
  webrtcState?: (on: boolean, reason?: string) => void;
  slowLink?: (uplink: boolean, lost: number, mid: string) => void;
  onmessage: (msg: JanusMessage, jsep?: JanusJsep) => void;
  onlocaltrack?: (track: MediaStreamTrack, on: boolean) => void;
  onremotetrack?: (track: MediaStreamTrack, mid: string, on: boolean, metadata?: JanusTrackMetadata) => void;
  ondataopen?: (label: string, protocol: string) => void;
  ondata?: (data: string) => void;
  oncleanup?: () => void;
  ondetached?: () => void;
}

export interface JanusInstance {
  attach(options: JanusPluginCallbacks): void;
  destroy(options?: { success?: () => void; error?: (error: string) => void; unload?: boolean; notifyDestroyed?: boolean; cleanupHandles?: boolean }): void;
  getSessionId(): number;
  isConnected(): boolean;
}

export interface JanusStatic {
  new(options: JanusConstructorOptions): JanusInstance;
  init(options: JanusInitOptions): void;
  isWebrtcSupported(): boolean;
  debug(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  randomString(length: number): string;
  attachMediaStream(element: HTMLVideoElement | HTMLAudioElement, stream: MediaStream): void;
  reattachMediaStream(to: HTMLVideoElement | HTMLAudioElement, from: HTMLVideoElement | HTMLAudioElement): void;
}
