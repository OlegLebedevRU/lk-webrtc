import { JanusClient, SipPlugin, getJanusConfig, getSipCredentials } from '../index.ts';
import { describeError, MediaRenderer, queryRequired, setAlert, setButtonState } from './common.ts';

const appStatus = queryRequired<HTMLElement>('#app-status');
const registerStatus = queryRequired<HTMLElement>('#register-status');
const callStatus = queryRequired<HTMLElement>('#call-status');
const proxyInput = queryRequired<HTMLInputElement>('#proxy');
const usernameInput = queryRequired<HTMLInputElement>('#username');
const authUserInput = queryRequired<HTMLInputElement>('#authuser');
const displayNameInput = queryRequired<HTMLInputElement>('#displayname');
const secretInput = queryRequired<HTMLInputElement>('#secret');
const registerButton = queryRequired<HTMLButtonElement>('#register');
const peerInput = queryRequired<HTMLInputElement>('#peer');
const callButton = queryRequired<HTMLButtonElement>('#call');
const useVideoCheckbox = queryRequired<HTMLInputElement>('#dovideo');

const localRenderer = new MediaRenderer(
  queryRequired<HTMLElement>('#sip-local-media'),
  'Локальные SIP-треки пока не созданы.',
  true,
);
const remoteRenderer = new MediaRenderer(
  queryRequired<HTMLElement>('#sip-remote-media'),
  'Во время звонка здесь появятся удаленные SIP-треки.',
);

let sipPlugin: SipPlugin | null = null;
let registered = false;
let inCall = false;

function updateRegisterButton(): void {
  setButtonState(registerButton, registered ? 'Перерегистрировать' : 'Зарегистрировать');
}

function updateCallButton(): void {
  setButtonState(callButton, inCall ? 'Завершить' : 'Позвонить', !registered && !inCall);
}

async function bootstrap(): Promise<void> {
  setAlert(appStatus, 'Инициализация SIP-клиента...', 'info');
  setAlert(registerStatus, 'Загрузка учетных данных...', 'info');
  setAlert(callStatus, 'Звонок не активен.', 'secondary');
  updateRegisterButton();
  updateCallButton();

  const defaults = await getSipCredentials();
  proxyInput.value = defaults.proxy;
  usernameInput.value = defaults.username;
  authUserInput.value = defaults.authuser;
  displayNameInput.value = defaults.displayName;
  secretInput.value = defaults.secret;

  const client = new JanusClient(getJanusConfig(), {
    onConnected: () => setAlert(appStatus, 'Соединение с Janus установлено.', 'success'),
    onError: (error) => setAlert(appStatus, error, 'danger'),
    onDestroyed: () => setAlert(appStatus, 'Сессия Janus завершена.', 'warning'),
  });

  await client.init();

  sipPlugin = new SipPlugin({
    onRegistered: (username) => {
      registered = true;
      updateRegisterButton();
      updateCallButton();
      setAlert(registerStatus, `SIP зарегистрирован: ${username}`, 'success');
    },
    onRegistrationFailed: (code, reason) => {
      registered = false;
      updateRegisterButton();
      updateCallButton();
      setAlert(registerStatus, `Ошибка регистрации (${code}): ${reason}`, 'danger');
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
        await sipPlugin?.answer(jsep, useVideoCheckbox.checked);
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
      localRenderer.clear();
      remoteRenderer.clear();
      setAlert(callStatus, reason || 'Звонок завершен.', 'warning');
    },
    onLocalTrack: (track, on) => {
      localRenderer.update(track, `local-${track.id}`, on, `Локальный ${track.kind}`);
    },
    onRemoteTrack: (track, mid, on) => {
      remoteRenderer.update(track, `remote-${mid}-${track.kind}`, on, `Удаленный ${track.kind}`);
    },
    onCleanup: () => {
      inCall = false;
      updateCallButton();
      localRenderer.clear();
      remoteRenderer.clear();
    },
    onError: (error) => setAlert(callStatus, error, 'danger'),
  });

  await sipPlugin.attach(client);
  await sipPlugin.register(defaults);
}

registerButton.addEventListener('click', async () => {
  if (!sipPlugin) {
    return;
  }

  setAlert(registerStatus, 'Отправка SIP-регистрации...', 'info');

  try {
    await sipPlugin.register({
      proxy: proxyInput.value.trim(),
      username: usernameInput.value.trim(),
      authuser: authUserInput.value.trim(),
      displayName: displayNameInput.value.trim(),
      secret: secretInput.value,
    });
  } catch (error) {
    setAlert(registerStatus, describeError(error), 'danger');
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
    await sipPlugin.call(uri, useVideoCheckbox.checked);
  } catch (error) {
    setAlert(callStatus, describeError(error), 'danger');
  }
});

void bootstrap().catch((error) => {
  const message = describeError(error);
  setAlert(appStatus, message, 'danger');
  setAlert(registerStatus, message, 'danger');
  setAlert(callStatus, message, 'danger');
  updateRegisterButton();
  updateCallButton();
});
