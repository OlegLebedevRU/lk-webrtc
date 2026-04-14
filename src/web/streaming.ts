import {
  JanusClient,
  SipPlugin,
  StreamingPlugin,
  API_KEY_NOT_SET_ERROR,
  clearApiKey,
  getApiKey,
  getAccountInfo,
  getJanusConfig,
  getSipCredentials,
  setApiKey,
} from '../index.ts';
import type { JanusJsep, StreamInfo } from '../index.ts';
import { describeError, MediaRenderer, queryRequired, setAlert, setButtonState } from './common.ts';

const janusStatus = queryRequired<HTMLElement>('#janus-status');
const streamStatus = queryRequired<HTMLElement>('#stream-status');
const streamSelect = queryRequired<HTMLSelectElement>('#stream-select');
const refreshStreamsButton = queryRequired<HTMLButtonElement>('#refresh-streams');
const watchStreamButton = queryRequired<HTMLButtonElement>('#watch-stream');
const streamMetadata = queryRequired<HTMLElement>('#stream-metadata');
const sipStatusIcon = queryRequired<HTMLElement>('#sip-status-icon');
const callStatus = queryRequired<HTMLElement>('#call-status');
const sipUsername = queryRequired<HTMLInputElement>('#sip-username');
const peerInput = queryRequired<HTMLInputElement>('#peer');
const callButton = queryRequired<HTMLButtonElement>('#call');
const callWidget = queryRequired<HTMLElement>('#call-widget');
const callWidgetTitle = queryRequired<HTMLElement>('#call-widget-title');
const callWidgetStatus = queryRequired<HTMLElement>('#call-widget-status');
const callWidgetIncoming = queryRequired<HTMLElement>('#call-widget-incoming');
const callWidgetActive = queryRequired<HTMLElement>('#call-widget-active');
const callAnswerButton = queryRequired<HTMLButtonElement>('#call-answer');
const callDeclineButton = queryRequired<HTMLButtonElement>('#call-decline');
const callOpenButton = queryRequired<HTMLButtonElement>('#call-open');
const callHangupButton = queryRequired<HTMLButtonElement>('#call-hangup');
const pinInput = queryRequired<HTMLInputElement>('#pin-input');
const pinSaveButton = queryRequired<HTMLButtonElement>('#pin-save');
const pinClearButton = queryRequired<HTMLButtonElement>('#pin-clear');
const pinStatus = queryRequired<HTMLElement>('#pin-status');
const pinCollapse = queryRequired<HTMLElement>('#pin-collapse');
const streamsCollapse = queryRequired<HTMLElement>('#streams-collapse');

const streamRenderer = new MediaRenderer(
  queryRequired<HTMLElement>('#stream-media'),
  'После запуска здесь появятся видео- и аудиотреки потока.',
);

let streamingPlugin: StreamingPlugin | null = null;
let sipPlugin: SipPlugin | null = null;
let sipRegistered = false;
let inCall = false;
let pendingIncomingJsep: JanusJsep | undefined = undefined;
let pendingIncomingCaller = '';
let defaultStreamId: number | null = null;
let activeCallPeer = '';

type BootstrapCollapseInstance = {
  show: () => void;
  hide: () => void;
};

type BootstrapApi = {
  Collapse: {
    getOrCreateInstance: (element: Element) => BootstrapCollapseInstance;
  };
};

function setJanusStatus(icon: string, title: string): void {
  janusStatus.textContent = icon;
  janusStatus.title = title;
}

function setSipStatus(icon: string, title: string): void {
  sipStatusIcon.textContent = icon;
  sipStatusIcon.title = title;
  sipStatusIcon.setAttribute('aria-label', title);
}

function updatePinStatus(): void {
  if (getApiKey()) {
    pinStatus.textContent = '✓ сохранён';
    pinStatus.className = 'badge bg-success ms-1';
    return;
  }
  pinStatus.textContent = 'не задан';
  pinStatus.className = 'badge bg-secondary ms-1';
}

function collapsePin(show: boolean): void {
  const bootstrap = (window as Window & { bootstrap?: BootstrapApi }).bootstrap;
  if (bootstrap?.Collapse) {
    const instance = bootstrap.Collapse.getOrCreateInstance(pinCollapse);
    if (show) {
      instance.show();
      return;
    }
    instance.hide();
    return;
  }

  pinCollapse.classList.toggle('show', show);
}

function collapseStreams(show: boolean): void {
  const bootstrap = (window as Window & { bootstrap?: BootstrapApi }).bootstrap;
  if (bootstrap?.Collapse) {
    const instance = bootstrap.Collapse.getOrCreateInstance(streamsCollapse);
    if (show) {
      instance.show();
    } else {
      instance.hide();
    }
    return;
  }
  streamsCollapse.classList.toggle('show', show);
}

function stopActiveStreamSafely(): void {
  if (!streamingPlugin) {
    return;
  }

  try {
    if (!streamingPlugin.getSelectedStream()) {
      return;
    }
    // stopStream may throw in transient Janus handle states; safe to ignore here.
    streamingPlugin.stopStream();
    streamRenderer.clear();
  } catch {
    // Non-critical: stream could already be stopped/detached.
    return;
  }
}

function showCallWidget(mode: 'incoming' | 'active', caller: string): void {
  callWidget.style.display = '';
  callWidgetTitle.textContent = mode === 'incoming'
    ? `📞 Входящий вызов: ${caller}`
    : `🔊 Разговор: ${caller}`;
  callWidgetStatus.textContent = mode === 'incoming' ? '📞' : '🔊';
  callWidgetIncoming.style.display = mode === 'incoming' ? '' : 'none';
  callWidgetActive.style.display = mode === 'active' ? '' : 'none';
}

function hideCallWidget(): void {
  callWidget.style.display = 'none';
  pendingIncomingJsep = undefined;
  pendingIncomingCaller = '';
  activeCallPeer = '';
}

function handleMissingApiKeyError(error: unknown): boolean {
  const message = describeError(error);
  if (message !== API_KEY_NOT_SET_ERROR) {
    return false;
  }

  setSipStatus('🔴', message);
  collapsePin(true);
  return true;
}

function updateCallButton(): void {
  setButtonState(callButton, inCall ? 'Завершить' : 'Позвонить', !sipRegistered && !inCall);
}

function renderStreams(streams: StreamInfo[]): void {
  streamSelect.innerHTML = '';

  if (streams.length === 0) {
    const option = document.createElement('option');
    option.textContent = 'Потоки не найдены';
    option.value = '';
    streamSelect.appendChild(option);
    watchStreamButton.disabled = true;
    streamMetadata.textContent = '';
    setAlert(streamStatus, 'Сервер не вернул доступных потоков.', 'warning');
    return;
  }

  for (const stream of streams) {
    const option = document.createElement('option');
    option.value = String(stream.id);
    option.textContent = `${stream.description || stream.id}`;
    streamSelect.appendChild(option);
  }

  watchStreamButton.disabled = false;
  renderSelectedStreamMetadata(streams);
  setAlert(streamStatus, `Получено потоков: ${streams.length}`, 'success');
}

function renderSelectedStreamMetadata(streams: StreamInfo[]): void {
  const selectedId = Number(streamSelect.value);
  const stream = streams.find((item) => item.id === selectedId) ?? streams[0];
  streamMetadata.textContent = stream ? JSON.stringify(stream, null, 2) : '';
}

async function init(): Promise<void> {
  setJanusStatus('🔵', 'Инициализация Janus...');
  setAlert(streamStatus, 'Загрузка списка потоков...', 'info');
  setSipStatus('🔵', 'Регистрация SIP...');
  setAlert(callStatus, 'Звонок не активен.', 'secondary');
  updateCallButton();
  updatePinStatus();
  pinInput.value = getApiKey() ?? '';

  const client = new JanusClient(await getJanusConfig(), {
    onConnected: () => setJanusStatus('🟢', 'Соединение с Janus установлено'),
    onError: (error) => setJanusStatus('🔴', error),
    onDestroyed: () => setJanusStatus('⚪', 'Сессия Janus завершена'),
  });

  await client.init();

  streamingPlugin = new StreamingPlugin({
    onStreamsList: (streams) => renderStreams(streams),
    onRemoteTrack: (track, mid, on) => {
      streamRenderer.update(track, `stream-${mid}-${track.kind}`, on, `Поток ${track.kind}`);
    },
    onCleanup: () => {
      streamRenderer.clear();
      setAlert(streamStatus, 'Просмотр потока остановлен.', 'warning');
    },
    onError: (error) => setAlert(streamStatus, error, 'danger'),
  });

  await streamingPlugin.attach(client);
  await streamingPlugin.updateStreamsList();

  sipPlugin = new SipPlugin({
    onRegistered: (username) => {
      sipRegistered = true;
      sipUsername.value = username;
      updateCallButton();
      setSipStatus('🟢', `SIP: ${username}`);
    },
    onRegistrationFailed: (code, reason) => {
      sipRegistered = false;
      updateCallButton();
      setSipStatus('🔴', `Ошибка регистрации (${code}): ${reason}`);
    },
    onCalling: () => {
      setAlert(callStatus, 'Идет вызов...', 'info');
    },
    onIncomingCall: async (caller, jsep) => {
      if (pendingIncomingCaller) {
        sipPlugin?.decline();
        setAlert(callStatus, 'Есть активный входящий вызов. Новый вызов отклонен.', 'warning');
        return;
      }
      pendingIncomingCaller = caller;
      pendingIncomingJsep = jsep;
      showCallWidget('incoming', caller);
      stopActiveStreamSafely();

      if (defaultStreamId && streamingPlugin) {
        try {
          await streamingPlugin.startStream(defaultStreamId);
        } catch {
          // Stream start failed, non-critical
        }
      }
    },
    onProgress: () => {
      setAlert(callStatus, 'Соединение устанавливается...', 'info');
    },
    onCallAccepted: () => {
      inCall = true;
      updateCallButton();
      const peer = activeCallPeer || pendingIncomingCaller;
      if (!peer) {
        return;
      }
      showCallWidget('active', peer);
      collapseStreams(false);
    },
    onCallHangup: (_code, reason) => {
      inCall = false;
      updateCallButton();
      hideCallWidget();
      collapseStreams(true);
      stopActiveStreamSafely();
      setAlert(callStatus, reason || 'Звонок завершен.', 'warning');
    },
    onLocalTrack: () => {
      // Local SIP media display removed
    },
    onRemoteTrack: () => {
      // Remote SIP media display removed
    },
    onCleanup: () => {
      inCall = false;
      updateCallButton();
      hideCallWidget();
      collapseStreams(true);
      stopActiveStreamSafely();
    },
    onError: (error) => setAlert(callStatus, error, 'danger'),
  });

  await sipPlugin.attach(client);
  let credentials: Awaited<ReturnType<typeof getSipCredentials>>;
  try {
    credentials = await getSipCredentials();
  } catch (error) {
    if (handleMissingApiKeyError(error)) {
      return;
    }
    throw error;
  }
  sipUsername.value = credentials.username;
  await sipPlugin.register(credentials);

  try {
    const accountInfo = await getAccountInfo();
    defaultStreamId = accountInfo.defaultStreamId ?? null;
  } catch {
    // Account info optional, non-critical
  }
}

pinSaveButton.addEventListener('click', async () => {
  const key = pinInput.value.trim();
  if (key) {
    setApiKey(key);
  } else {
    clearApiKey();
  }
  updatePinStatus();
  collapsePin(false);

  const plugin = sipPlugin;
  if (plugin && !sipRegistered) {
    setSipStatus('🔵', 'Загрузка SIP-учётных данных...');
    try {
      const credentials = await getSipCredentials();
      if (sipRegistered) {
        return;
      }
      sipUsername.value = credentials.username;
      await plugin.register(credentials);
    } catch (error) {
      if (!handleMissingApiKeyError(error)) {
        setSipStatus('🔴', `Не удалось загрузить учётные данные SIP: ${describeError(error)}`);
      }
    }
  }
});

pinClearButton.addEventListener('click', () => {
  clearApiKey();
  pinInput.value = '';
  updatePinStatus();
});

refreshStreamsButton.addEventListener('click', async () => {
  if (!streamingPlugin) {
    return;
  }
  setAlert(streamStatus, 'Обновление списка потоков...', 'info');
  try {
    await streamingPlugin.updateStreamsList();
  } catch (error) {
    setAlert(streamStatus, describeError(error), 'danger');
  }
});

streamSelect.addEventListener('change', () => {
  if (!streamingPlugin) {
    return;
  }
  renderSelectedStreamMetadata(streamingPlugin.getAllStreams());
});

watchStreamButton.addEventListener('click', async () => {
  if (!streamingPlugin || !streamSelect.value) {
    return;
  }

  setAlert(streamStatus, 'Запрос на запуск потока отправлен.', 'info');

  try {
    stopActiveStreamSafely();
    await streamingPlugin.startStream(Number(streamSelect.value));
    renderSelectedStreamMetadata(streamingPlugin.getAllStreams());
  } catch (error) {
    setAlert(streamStatus, describeError(error), 'danger');
  }
});

callButton.addEventListener('click', async () => {
  if (!sipPlugin) {
    return;
  }

  if (inCall) {
    sipPlugin.hangup();
    return;
  }

  const uri = peerInput.value.trim();
  if (!uri) {
    setAlert(callStatus, 'Укажите SIP URI для звонка.', 'warning');
    return;
  }

  try {
    activeCallPeer = uri;
    await sipPlugin.call(uri, false);
  } catch (error) {
    activeCallPeer = '';
    setAlert(callStatus, describeError(error), 'danger');
  }
});

callAnswerButton.addEventListener('click', async () => {
  if (!sipPlugin) return;
  const incomingPeer = pendingIncomingCaller;
  const isOfferlessAnswer = !pendingIncomingJsep;
  activeCallPeer = incomingPeer;
  try {
    await sipPlugin.answer(pendingIncomingJsep, isOfferlessAnswer, false);
    pendingIncomingJsep = undefined;
    pendingIncomingCaller = '';
    showCallWidget('active', activeCallPeer);
  } catch (error) {
    setAlert(callStatus, describeError(error), 'danger');
  }
});

callDeclineButton.addEventListener('click', () => {
  if (!sipPlugin) return;
  sipPlugin.decline();
  hideCallWidget();
});

callOpenButton.addEventListener('click', () => {
  if (!sipPlugin) return;
  sipPlugin.sendDtmf('1');
});

callHangupButton.addEventListener('click', () => {
  if (!sipPlugin) return;
  sipPlugin.hangup();
});

void init().catch((error) => {
  const message = describeError(error);
  setJanusStatus('🔴', message);
  setAlert(streamStatus, message, 'danger');
  if (handleMissingApiKeyError(error)) {
    updateCallButton();
    return;
  }
  setSipStatus('🔴', message);
  updateCallButton();
});
