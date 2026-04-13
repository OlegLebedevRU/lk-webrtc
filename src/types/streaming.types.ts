/**
 * TypeScript type definitions for Janus Streaming Plugin.
 */

export interface StreamMedia {
  type: 'audio' | 'video' | 'data';
  mid: string;
  label?: string;
  codec?: string;
  pt?: number;
  rtpmap?: string;
  fmtp?: string;
}

export interface StreamInfo {
  id: number;
  description: string;
  type: 'live' | 'on demand' | 'rtsp' | string;
  media?: StreamMedia[];
  metadata?: string;
  legacy?: boolean;
  enabled?: boolean;
  audio_age_ms?: number;
  video_age_ms?: number;
}

export interface StreamingListRequest {
  [key: string]: unknown;
  request: 'list';
}

export interface StreamingInfoRequest {
  [key: string]: unknown;
  request: 'info';
  id: number;
  secret?: string;
}

export interface StreamingWatchRequest {
  [key: string]: unknown;
  request: 'watch';
  id: number;
  secret?: string;
  offer_audio?: boolean;
  offer_video?: boolean;
  offer_data?: boolean;
}

export interface StreamingStartRequest {
  [key: string]: unknown;
  request: 'start';
}

export interface StreamingStopRequest {
  [key: string]: unknown;
  request: 'stop';
}

export interface StreamingPauseRequest {
  [key: string]: unknown;
  request: 'pause';
}

export interface StreamingConfigureRequest {
  [key: string]: unknown;
  request: 'configure';
  mid?: string;
  send?: boolean;
  substream?: number;
  temporal?: number;
  spatial_layer?: number;
  temporal_layer?: number;
  fallback?: number;
}

export interface StreamingSwitchRequest {
  [key: string]: unknown;
  request: 'switch';
  id: number;
  secret?: string;
}

export interface StreamingListResult {
  list: StreamInfo[];
}

export type StreamingStatus = 'idle' | 'watching' | 'started' | 'paused' | 'stopped';
