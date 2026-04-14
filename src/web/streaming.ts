import {
  JanusClient,
  SipPlugin,
  StreamingPlugin,
  getJanusConfig,
  getSipCredentials,
} from '../index.ts';
import type { StreamInfo } from '../index.ts';
import { describeError, MediaRenderer, queryRequired, setAlert, setButtonState } from './common.ts';

const appStatus = queryRequired<HTMLElement>('#app-status');
const streamStatus = queryRequired<HTMLElement>('#stream-status');
const streamSelect = queryRequired<HTMLSelectElement>('#stream-select');
const refreshStreamsButton = queryRequired<HTMLButtonElement>('#refresh-streams');
const watchStreamButton = queryRequired<HTMLButtonElement>('#watch-stream');
const streamMetadata = queryRequired<HTMLElement>('#stream-metadata');
const sipStatus = queryRequired<HTMLElement>('#sip-status');
const callStatus = queryRequired<HTMLElement>('#call-status');
const sipUsername = queryRequired<HTMLInputElement>('#sip-username');
const peerInput = queryRequired<HTMLInputElement>('#peer');
const callButton = queryRequired<HTMLButtonElement>('#call');

const streamRenderer = new MediaRenderer(
  queryRequired<HTMLElement>('#stream-media'),
  'После запуска здесь появятся видео- и аудиотреки потока.',
);

let streamingPlugin: StreamingPlugin | null = null;
let sipPlugin: SipPlugin | null = null;
let sipRegistered = false;
let inCall = false;

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
  setAlert(appStatus, 'Инициализация Janus и подключение модульного web-клиента...', 'info');
  setAlert(streamStatus, 'Загрузка списка потоков...', 'info');
  setAlert(sipStatus, 'Регистрация SIP...', 'info');
  setAlert(callStatus, 'Звонок не активен.', 'secondary');
  updateCallButton();

  const client = new JanusClient(await getJanusConfig(), {
    onConnected: () => setAlert(appStatus, 'Соединение с Janus установлено.', 'success'),
    onError: (error) => setAlert(appStatus, error, 'danger'),
    onDestroyed: () => setAlert(appStatus, 'Сессия Janus завершена.', 'warning'),
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
      setAlert(sipStatus, `SIP зарегистрирован: ${username}`, 'success');
    },
    onRegistrationFailed: (code, reason) => {
      sipRegistered = false;
      updateCallButton();
      setAlert(sipStatus, `Ошибка регистрации (${code}): ${reason}`, 'danger');
    },
    onCalling: () => {
      setAlert(callStatus, 'Идет вызов...', 'info');
    },
    onIncomingCall: async (caller, jsep) => {
      const accepted = window.confirm(`Входящий вызов от ${caller}. Принять?`);
      if (!accepted) {
        sipPlugin?.decline();
        setAlert(callStatus, `Вызов от ${caller} отклонен.`, 'warning');
        return;
      }

      try {
        await sipPlugin?.answer(jsep, !jsep, false);
        setAlert(callStatus, `Вызов от ${caller} принят.`, 'success');
      } catch (error) {
        setAlert(callStatus, describeError(error), 'danger');
      }
    },
    onProgress: () => {
      setAlert(callStatus, 'Соединение устанавливается...', 'info');
    },
    onCallAccepted: () => {
      inCall = true;
      updateCallButton();
      setAlert(callStatus, 'Звонок установлен.', 'success');
    },
    onCallHangup: (_code, reason) => {
      inCall = false;
      updateCallButton();
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
    },
    onError: (error) => setAlert(callStatus, error, 'danger'),
  });

  await sipPlugin.attach(client);
  const credentials = await getSipCredentials();
  sipUsername.value = credentials.username;
  await sipPlugin.register(credentials);
}

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
    await sipPlugin.call(uri, false);
  } catch (error) {
    setAlert(callStatus, describeError(error), 'danger');
  }
});

void init().catch((error) => {
  const message = describeError(error);
  setAlert(appStatus, message, 'danger');
  setAlert(streamStatus, message, 'danger');
  setAlert(sipStatus, message, 'danger');
  updateCallButton();
});
