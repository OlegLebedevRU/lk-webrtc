import type { JanusClient } from '../core/JanusClient.ts';
import type {
  JanusPluginHandle,
  JanusMessage,
  JanusJsep,
  JanusTrackOption,
} from '../types/janus.d.ts';
import type {
  StreamInfo,
  StreamingListResult,
  StreamingListRequest,
  StreamingInfoRequest,
  StreamingWatchRequest,
  StreamingStartRequest,
  StreamingStopRequest,
  StreamingPauseRequest,
  StreamingConfigureRequest,
  StreamingSwitchRequest,
  StreamingStatus,
} from '../types/streaming.types.ts';
import { generateOpaqueId } from '../utils/helpers.ts';

export interface StreamingPluginCallbacks {
  onStreamsList?: (streams: StreamInfo[]) => void;
  onStreamStarted?: (streamId: number) => void;
  onStreamStopped?: () => void;
  onRemoteTrack?: (track: MediaStreamTrack, mid: string, on: boolean) => void;
  onCleanup?: () => void;
  onError?: (error: string) => void;
}

/**
 * Wrapper around the Janus Streaming Plugin.
 * Handles stream listing, watching, start/stop/pause, and simulcast configuration.
 * Does not depend on DOM or jQuery.
 */
export class StreamingPlugin {
  private readonly callbacks: StreamingPluginCallbacks;
  private handle: JanusPluginHandle | null = null;
  private streams: StreamInfo[] = [];
  private selectedStream: StreamInfo | null = null;
  private status: StreamingStatus = 'idle';
  private readonly opaqueId: string;

  constructor(callbacks: StreamingPluginCallbacks = {}) {
    this.callbacks = callbacks;
    this.opaqueId = generateOpaqueId('streamingtest', 12);
  }

  /**
   * Attaches the Streaming plugin to an active JanusClient session.
   */
  async attach(client: JanusClient): Promise<void> {
    this.handle = await client.attachPlugin({
      plugin: 'janus.plugin.streaming',
      opaqueId: this.opaqueId,
      onmessage: (msg: JanusMessage, jsep?: JanusJsep) => this.handleMessage(msg, jsep),
      onremotetrack: (track: MediaStreamTrack, mid: string, on: boolean) => {
        this.callbacks.onRemoteTrack?.(track, mid, on);
      },
      oncleanup: () => {
        this.status = 'idle';
        this.selectedStream = null;
        this.callbacks.onCleanup?.();
      },
    });
  }

  /**
   * Fetches the list of available streams from the server.
   * The Janus Streaming Plugin responds to 'list' as a synchronous transaction,
   * so the result is delivered via the success callback of send(), not onmessage.
   */
  async updateStreamsList(): Promise<StreamInfo[]> {
    this.ensureHandle();
    const request: StreamingListRequest = { request: 'list' };
    return new Promise((resolve, reject) => {
      this.handle!.send({
        message: request,
        success: (data?: Record<string, unknown>) => {
          const listResult = data as StreamingListResult | undefined;
          if (listResult?.list) {
            this.streams = listResult.list;
            this.callbacks.onStreamsList?.(this.streams);
          }
          resolve(this.streams);
        },
        error: (cause: string) => {
          this.callbacks.onError?.(cause);
          reject(new Error(cause));
        },
      });
    });
  }

  /**
   * Starts watching a stream by its ID.
   */
  async startStream(streamId: number): Promise<void> {
    this.ensureHandle();
    const request: StreamingWatchRequest = { request: 'watch', id: streamId };
    this.handle!.send({ message: request });
    this.selectedStream = this.streams.find((stream) => stream.id === streamId) ?? null;
    this.status = 'watching';
  }

  /**
   * Sends a stop request to the streaming plugin.
   */
  stopStream(): void {
    this.ensureHandle();
    const request: StreamingStopRequest = { request: 'stop' };
    this.handle!.send({ message: request });
    this.status = 'stopped';
    this.selectedStream = null;
  }

  /**
   * Pauses the current stream.
   */
  pauseStream(): void {
    this.ensureHandle();
    const request: StreamingPauseRequest = { request: 'pause' };
    this.handle!.send({ message: request });
    this.status = 'paused';
  }

  /**
   * Resumes a paused stream.
   */
  startMedia(): void {
    this.ensureHandle();
    const request: StreamingStartRequest = { request: 'start' };
    this.handle!.send({ message: request });
    this.status = 'started';
  }

  /**
   * Switches to a different stream without tearing down the WebRTC connection.
   */
  switchStream(streamId: number): void {
    this.ensureHandle();
    const request: StreamingSwitchRequest = { request: 'switch', id: streamId };
    this.handle!.send({ message: request });
    this.selectedStream = this.streams.find((stream) => stream.id === streamId) ?? null;
  }

  /**
   * Requests detailed info about a stream.
   */
  getStreamInfo(streamId: number): void {
    this.ensureHandle();
    const request: StreamingInfoRequest = { request: 'info', id: streamId };
    this.handle!.send({ message: request });
  }

  /**
   * Configures simulcast parameters for a given media mid.
   */
  configureSimulcast(mid: string, substream: number, temporal: number): void {
    this.ensureHandle();
    const request: StreamingConfigureRequest = {
      request: 'configure',
      mid,
      substream,
      temporal,
    };
    this.handle!.send({ message: request });
  }

  /**
   * Configures SVC (Scalable Video Coding) layers.
   */
  configureSvc(mid: string, spatialLayer: number, temporalLayer: number): void {
    this.ensureHandle();
    const request: StreamingConfigureRequest = {
      request: 'configure',
      mid,
      spatial_layer: spatialLayer,
      temporal_layer: temporalLayer,
    };
    this.handle!.send({ message: request });
  }

  /**
   * Returns the current bitrate estimate for a given mid.
   */
  getBitrate(mid?: string): string {
    if (!this.handle) return '0 kbits/sec';
    return this.handle.getBitrate(mid);
  }

  getSelectedStream(): StreamInfo | null {
    return this.selectedStream;
  }

  getAllStreams(): StreamInfo[] {
    return this.streams;
  }

  getHandle(): JanusPluginHandle | null {
    return this.handle;
  }

  /**
   * Detaches the plugin handle from the Janus session.
   */
  detach(): void {
    if (this.handle) {
      this.handle.detach();
      this.handle = null;
    }
  }

  private handleMessage(msg: JanusMessage, jsep?: JanusJsep): void {
    const streaming = msg['streaming'] as string | undefined;
    const result = msg['result'] as Record<string, unknown> | undefined;
    const error = msg['error'] as string | undefined;

    if (error) {
      this.callbacks.onError?.(error);
      return;
    }

    if (streaming === 'list' || streaming === 'update') {
      // Handles asynchronous list/update notifications pushed by the server.
      // Client-initiated list requests are handled via the success callback in updateStreamsList().
      const list = msg['list'] as StreamInfo[] | undefined;
      if (list) {
        this.streams = list;
        this.callbacks.onStreamsList?.(this.streams);
      }
      return;
    }

    if (streaming === 'event') {
      const status = (result?.['status']) as string | undefined;
      if (status === 'started') {
        this.status = 'started';
        const streamId = this.selectedStream?.id;
        if (streamId !== undefined) {
          this.callbacks.onStreamStarted?.(streamId);
        }
      } else if (status === 'stopped' || status === 'error') {
        this.status = 'stopped';
        this.callbacks.onStreamStopped?.();
      }
      return;
    }

    // Handle SDP offer from the plugin
    if (jsep) {
      const tracks: JanusTrackOption[] = [
        { type: 'audio', recv: true },
        { type: 'video', recv: true },
      ];
      this.handle!.createAnswer({
        jsep,
        tracks,
        success: (answerJsep: JanusJsep) => {
          const startRequest: StreamingStartRequest = { request: 'start' };
          this.handle!.send({ message: startRequest, jsep: answerJsep });
          this.status = 'started';
        },
        error: (error: Error) => {
          this.callbacks.onError?.(error.message);
        },
      });
    }
  }

  private ensureHandle(): void {
    if (!this.handle) {
      throw new Error('StreamingPlugin is not attached. Call attach() first.');
    }
  }
}
