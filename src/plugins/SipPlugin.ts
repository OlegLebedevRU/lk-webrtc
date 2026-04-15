import type { JanusClient } from '../core/JanusClient.ts';
import type {
  JanusPluginHandle,
  JanusMessage,
  JanusJsep,
  JanusTrackOption,
} from '../types/janus.d.ts';
import type {
  SipCredentials,
  SipEvent,
  SipEventResult,
  SipRegisterRequest,
  SipCallRequest,
  SipAcceptRequest,
  SipHangupRequest,
  SipDeclineRequest,
  SipDtmfRequest,
  SipMessageRequest,
  SipTransferRequest,
} from '../types/sip.types.ts';
import { generateOpaqueId } from '../utils/helpers.ts';

export interface SipPluginCallbacks {
  onRegistered?: (username: string) => void;
  onRegistrationFailed?: (code: number, reason: string) => void;
  onCalling?: () => void;
  onIncomingCall?: (caller: string, jsep?: JanusJsep) => void;
  onProgress?: (jsep?: JanusJsep) => void;
  onCallAccepted?: (jsep?: JanusJsep) => void;
  onCallHangup?: (code: number, reason: string) => void;
  onRemoteTrack?: (track: MediaStreamTrack, mid: string, on: boolean) => void;
  onLocalTrack?: (track: MediaStreamTrack, on: boolean) => void;
  onMessage?: (content: string, sender: string) => void;
  onCleanup?: () => void;
  onError?: (error: string) => void;
}

/**
 * Wrapper around the Janus SIP Plugin.
 * Handles SIP registration, calls, DTMF, messages, and transfers.
 * Does not depend on DOM or jQuery.
 */
export class SipPlugin {
  private readonly callbacks: SipPluginCallbacks;
  private handle: JanusPluginHandle | null = null;
  private registered = false;
  private callId: string | null = null;
  private masterId: number | null = null;
  private readonly opaqueId: string;

  constructor(callbacks: SipPluginCallbacks = {}) {
    this.callbacks = callbacks;
    this.opaqueId = generateOpaqueId('siptest', 12);
  }

  /**
   * Attaches the SIP plugin to an active JanusClient session.
   */
  async attach(client: JanusClient): Promise<void> {
    this.handle = await client.attachPlugin({
      plugin: 'janus.plugin.sip',
      opaqueId: this.opaqueId,
      onmessage: (msg: JanusMessage, jsep?: JanusJsep) => this.handleMessage(msg, jsep),
      onlocaltrack: (track: MediaStreamTrack, on: boolean) => {
        this.callbacks.onLocalTrack?.(track, on);
      },
      onremotetrack: (track: MediaStreamTrack, mid: string, on: boolean) => {
        this.callbacks.onRemoteTrack?.(track, mid, on);
      },
      oncleanup: () => {
        this.callId = null;
        this.masterId = null;
        this.callbacks.onCleanup?.();
      },
    });
  }

  /**
   * Registers with the SIP server using the provided credentials.
   */
  async register(credentials: SipCredentials, type: 'guest' | 'default' = 'default'): Promise<void> {
    this.ensureHandle();
    const request: SipRegisterRequest = {
      request: 'register',
      username: credentials.username,
      authuser: credentials.authuser,
      display_name: credentials.displayName,
      proxy: credentials.proxy,
      secret: credentials.secret,
      type,
    };
    this.handle!.send({ message: request });
  }

  /**
   * Initiates a SIP call to the given URI.
   */
  async call(uri: string, useVideo = false): Promise<void> {
    this.ensureHandle();

    const tracks: JanusTrackOption[] = [{ type: 'audio', capture: true, recv: true }];
    if (useVideo) {
      tracks.push({ type: 'video', capture: true, recv: true });
    }

    return new Promise((resolve, reject) => {
      this.handle!.createOffer({
        tracks,
        success: (jsep: JanusJsep) => {
          const request: SipCallRequest = {
            request: 'call',
            uri,
            autoaccept_reinvites: false,
            video: useVideo,
          };
          this.handle!.send({ message: request, jsep });
          resolve();
        },
        error: (error: Error) => {
          this.callbacks.onError?.(error.message);
          reject(error);
        },
      });
    });
  }

  /**
   * Answers an incoming SIP call.
   * Pass `offerless = true` when Janus reports an incoming call without a JSEP offer.
   * In that case `jsep` may be omitted and the plugin will create a local offer instead.
   */
  async answer(jsep?: JanusJsep, offerless = false, useVideo = false): Promise<void> {
    this.ensureHandle();

    if (offerless || !jsep) {
      const tracks: JanusTrackOption[] = [{ type: 'audio', capture: true, recv: true }];
      if (useVideo) {
        tracks.push({ type: 'video', capture: true, recv: true });
      }

      return new Promise((resolve, reject) => {
        this.handle!.createOffer({
          tracks,
          success: (answerJsep: JanusJsep) => {
            const request: SipAcceptRequest = { request: 'accept' };
            this.handle!.send({ message: request, jsep: answerJsep });
            resolve();
          },
          error: (error: Error) => {
            this.callbacks.onError?.(error.message);
            reject(error);
          },
        });
      });
    }

    return new Promise((resolve, reject) => {
      const tracks: JanusTrackOption[] = [{ type: 'audio', capture: true, recv: true }];
      if (useVideo) {
        tracks.push({ type: 'video', capture: true, recv: true });
      }
      this.handle!.createAnswer({
        jsep,
        tracks,
        success: (answerJsep: JanusJsep) => {
          const request: SipAcceptRequest = { request: 'accept' };
          this.handle!.send({ message: request, jsep: answerJsep });
          resolve();
        },
        error: (error: Error) => {
          this.callbacks.onError?.(error.message);
          reject(error);
        },
      });
    });
  }

  /**
   * Declines an incoming call with an optional SIP status code.
   */
  decline(code = 486): void {
    this.ensureHandle();
    const request: SipDeclineRequest = { request: 'decline', code };
    this.handle!.send({ message: request });
  }

  /**
   * Hangs up the current call.
   */
  hangup(): void {
    this.ensureHandle();
    const request: SipHangupRequest = { request: 'hangup' };
    this.handle!.send({ message: request });
  }

  /**
   * Sends DTMF tones using SIP INFO messages.
   */
  sendDtmf(tones: string): void {
    this.ensureHandle();
    const request: SipDtmfRequest = { request: 'dtmf_info', digit: tones };
    this.handle!.send({ message: request });
  }

  /**
   * Sends a SIP MESSAGE to the current or a specified peer.
   */
  sendMessage(content: string, uri?: string): void {
    this.ensureHandle();
    const request: SipMessageRequest = { request: 'message', content, uri };
    this.handle!.send({ message: request });
  }

  /**
   * Transfers the active call to another URI.
   */
  transfer(uri: string, replace?: string): void {
    this.ensureHandle();
    const request: SipTransferRequest = { request: 'transfer', uri, replace };
    this.handle!.send({ message: request });
  }

  isRegistered(): boolean {
    return this.registered;
  }

  getCallId(): string | null {
    return this.callId;
  }

  getMasterId(): number | null {
    return this.masterId;
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
    const result = msg['result'] as SipEventResult | undefined;
    if (!result) {
      const errorCode = msg['error_code'] as number | undefined;
      const errorText = msg['error'] as string | undefined;
      if (errorText) {
        this.callbacks.onError?.(errorText);
        if (errorCode === 458) {
          this.registered = false;
        }
      }
      return;
    }

    const resultData = result as unknown as Record<string, unknown>;
    const nestedData =
      typeof resultData['result'] === 'object' && resultData['result'] !== null
        ? (resultData['result'] as Record<string, unknown>)
        : null;
    const eventData = nestedData ?? resultData;
    const event =
      (eventData['event'] as SipEvent | undefined)
      ?? (resultData['event'] as SipEvent | undefined);
    if (!event) return;

    switch (event) {
      case 'registered':
        this.registered = true;
        this.callbacks.onRegistered?.(
          (eventData['username'] as string | undefined)
          ?? (resultData['username'] as string | undefined)
          ?? '',
        );
        break;

      case 'registration_failed':
        this.registered = false;
        this.callbacks.onRegistrationFailed?.(
          (eventData['code'] as number | undefined)
          ?? (resultData['code'] as number | undefined)
          ?? 0,
          (eventData['reason'] as string | undefined)
          ?? (resultData['reason'] as string | undefined)
          ?? 'Unknown error',
        );
        break;

      case 'calling':
        this.callbacks.onCalling?.();
        break;

      case 'incomingcall': {
        this.callId =
          (msg['call_id'] as string | undefined)
          ?? (eventData['call_id'] as string | undefined)
          ?? (resultData['call_id'] as string | undefined)
          ?? null;
        this.masterId = null;
        const caller =
          (eventData['caller'] as string | undefined)
          ?? (eventData['username'] as string | undefined)
          ?? (resultData['caller'] as string | undefined)
          ?? (resultData['username'] as string | undefined)
          ?? '';
        this.callbacks.onIncomingCall?.(caller, jsep);
        break;
      }

      case 'progress':
        if (jsep) {
          this.handle?.handleRemoteJsep({ jsep });
        }
        this.callbacks.onProgress?.(jsep);
        break;

      case 'accepted':
        this.masterId =
          (eventData['master_id'] as number | undefined)
          ?? (resultData['master_id'] as number | undefined)
          ?? null;
        if (jsep) {
          this.handle?.handleRemoteJsep({ jsep });
        }
        this.callbacks.onCallAccepted?.(jsep);
        break;

      case 'hangup':
        this.callId = null;
        this.masterId = null;
        this.callbacks.onCallHangup?.(
          (eventData['code'] as number | undefined)
          ?? (resultData['code'] as number | undefined)
          ?? 0,
          (eventData['reason'] as string | undefined)
          ?? (resultData['reason'] as string | undefined)
          ?? '',
        );
        break;

      case 'message': {
        const content =
          (eventData['content'] as string | undefined)
          ?? (resultData['content'] as string | undefined)
          ?? '';
        const sender =
          (eventData['caller'] as string | undefined)
          ?? (eventData['username'] as string | undefined)
          ?? (resultData['caller'] as string | undefined)
          ?? (resultData['username'] as string | undefined)
          ?? '';
        this.callbacks.onMessage?.(content, sender);
        break;
      }

      default:
        break;
    }
  }

  private ensureHandle(): void {
    if (!this.handle) {
      throw new Error('SipPlugin is not attached. Call attach() first.');
    }
  }
}
