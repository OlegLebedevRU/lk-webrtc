import adapter from 'webrtc-adapter';
import type {
  JanusInstance,
  JanusInitOptions,
  JanusPluginHandle,
  JanusPluginCallbacks,
  JanusConstructorOptions,
} from '../types/janus.d.ts';
import type { AppConfig } from '../config/settings.ts';

// Janus is loaded as a global script (vendor library)
declare const Janus: {
  new(options: JanusConstructorOptions): JanusInstance;
  init(options: JanusInitOptions): void;
  useDefaultDependencies(deps?: Record<string, unknown>): Record<string, unknown>;
  isWebrtcSupported(): boolean;
  randomString(length: number): string;
};

export interface JanusClientCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: string) => void;
  onDestroyed?: () => void;
}

/**
 * Platform-agnostic wrapper around the Janus WebRTC gateway client.
 * Handles initialization, session management, and plugin attachment.
 * Does not depend on DOM or jQuery.
 */
export class JanusClient {
  private readonly config: AppConfig;
  private readonly callbacks: JanusClientCallbacks;
  private instance: JanusInstance | null = null;
  private connected = false;

  constructor(config: AppConfig, callbacks: JanusClientCallbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * Initializes the Janus library and creates a new session.
   */
  async init(): Promise<void> {
    await this.initJanusLibrary();
    await this.createSession();
  }

  private initJanusLibrary(): Promise<void> {
    return new Promise((resolve) => {
      Janus.init({
        debug: false,
        dependencies: Janus.useDefaultDependencies({ adapter }),
        callback: () => resolve(),
      });
    });
  }

  private createSession(): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: JanusConstructorOptions = {
        server: this.config.janusServer,
        iceServers: this.config.iceServers ?? undefined,
        success: () => {
          this.connected = true;
          this.callbacks.onConnected?.();
          resolve();
        },
        error: (cause: string) => {
          this.connected = false;
          this.callbacks.onError?.(cause);
          reject(new Error(cause));
        },
        destroyed: () => {
          this.connected = false;
          this.instance = null;
          this.callbacks.onDestroyed?.();
        },
      };

      this.instance = new Janus(options);
    });
  }

  /**
   * Attaches a plugin to the current Janus session.
   */
  async attachPlugin(options: Omit<JanusPluginCallbacks, 'success' | 'error'>): Promise<JanusPluginHandle> {
    if (!this.instance) {
      throw new Error('JanusClient is not initialized. Call init() first.');
    }

    const session = this.instance;

    return new Promise((resolve, reject) => {
      session.attach({
        ...options,
        success: (handle: JanusPluginHandle) => resolve(handle),
        error: (cause: string) => reject(new Error(cause)),
      } as JanusPluginCallbacks);
    });
  }

  /**
   * Destroys the current Janus session.
   */
  destroy(): void {
    if (this.instance) {
      this.instance.destroy();
      this.instance = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected && this.instance !== null && this.instance.isConnected();
  }

  getSessionId(): number | null {
    return this.instance?.getSessionId() ?? null;
  }

  getRawInstance(): JanusInstance | null {
    return this.instance;
  }
}
