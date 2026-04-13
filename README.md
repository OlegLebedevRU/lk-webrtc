# lk-webrtc

Клиентское веб-приложение для просмотра видеопотоков и SIP-звонков через [Janus WebRTC Gateway](https://github.com/meetecho/janus-gateway).

---

## Описание

**lk-webrtc** обеспечивает:

- 📹 **Просмотр видеопотоков** через Janus Streaming Plugin
- 📞 **SIP-звонки** (входящие и исходящие) через Janus SIP Plugin
- 🔄 **Комбинированный режим** — одновременная работа стриминга и SIP

Проект поддерживает два режима работы:

| Режим | Описание |
|---|---|
| **Legacy** | Оригинальные монолитные файлы (`index.html` → `streaming.html`, `sip.html`). Работают без сборки, «из коробки». |
| **Новый (TypeScript)** | Модульная архитектура в `src/`, совместимая с Vite и React Native. |

---

## Структура репозитория

```
lk-webrtc/
├── src/                        # Новый TypeScript-модульный код
│   ├── types/
│   │   ├── janus.d.ts          # Типы для Janus API
│   │   ├── sip.types.ts        # Интерфейсы SIP-плагина
│   │   ├── streaming.types.ts  # Интерфейсы Streaming-плагина
│   │   └── index.ts            # Реэкспорт всех типов
│   ├── config/
│   │   └── settings.ts         # Конфигурация (сервер, SIP-учётные данные)
│   ├── core/
│   │   └── JanusClient.ts      # Обёртка над Janus: init, сессия, destroy
│   ├── plugins/
│   │   ├── SipPlugin.ts        # SIP: регистрация, звонки, DTMF, сообщения
│   │   └── StreamingPlugin.ts  # Streaming: list, watch, start/stop/pause
│   ├── utils/
│   │   └── helpers.ts          # Утилиты: escapeXml, generateOpaqueId, debounce...
│   └── index.ts                # Единая точка экспорта
│
├── index.html                  # Стартовая страница: сразу открывает Streaming + SIP
├── streaming.html              # Legacy UI — стриминг + SIP (jQuery)
├── streaming.js                # Legacy логика стриминга (монолит)
├── sip.html                    # Legacy UI — SIP Gateway Demo
├── sip.js                      # Legacy логика SIP (монолит)
├── settings.js                 # Legacy конфигурация Janus
├── janus.js                    # Вендорная библиотека Janus (~118 КБ)
├── demo.css                    # Общие стили для legacy UI
├── nop.html                    # Заглушка navbar/footer
├── package.json                # Зависимости и скрипты npm
├── tsconfig.json               # Конфигурация TypeScript
├── vite.config.ts              # Конфигурация Vite
└── README.md
```

---

## Быстрый старт

### Legacy-режим (без сборки)

Просто откройте в браузере:

```
index.html       — стартовая страница, сразу открывает Streaming + SIP
streaming.html   — просмотр видеопотоков + SIP
sip.html         — только SIP Gateway Demo
```

Никакой установки не требуется. Конфигурация сервера — в `settings.js`.

### Новый режим (TypeScript + Vite)

```bash
# Установить зависимости
npm install

# Запустить dev-сервер (порт 3000)
npm run dev

# Проверить типы
npm run typecheck

# Запустить линтинг
npm run lint

# Собрать для production
npm run build
```

---

## Стек технологий

| Слой | Технологии |
|---|---|
| **Язык** | TypeScript 5.4, ES2020 |
| **Сборка** | Vite 5.4 |
| **Линтинг** | ESLint 8 + @typescript-eslint |
| **WebRTC** | Janus WebRTC Gateway (SIP Plugin, Streaming Plugin) |
| **Legacy UI** | jQuery, Bootstrap (CDN), Toastr |

---

## Конфигурация

### Сервер Janus

В файле `src/config/settings.ts` функция `getJanusConfig()` автоматически определяет адрес сервера по протоколу страницы:

| Протокол | Адрес Janus |
|---|---|
| HTTP | `http://iot.leo4.ru:8088/janus` |
| HTTPS | `wss://iot.leo4.ru:8989` |

> **TODO:** Заменить на вызов API для получения конфигурации с бэкенда.

### SIP-учётные данные

Функция `getSipCredentials()` возвращает данные для регистрации:

```typescript
{
  username:    'sip:6004@87.242.100.34',
  authuser:    '6004',
  displayName: 'Panel N 6004',
  proxy:       'sip:87.242.100.34:5060',
  secret:      '6004',
}
```

> **TODO:** Заменить на вызов API для получения учётных данных с бэкенда.

---

## Архитектурный принцип

Ключевая идея — **полное разделение бизнес-логики и UI**:

```
┌────────────────────────────────────────┐
│  UI Layer (web / React Native / Flutter)│
│  (НЕ входит в src/ — пишется отдельно) │
└─────────────────┬──────────────────────┘
                  │ вызывает
┌─────────────────▼──────────────────────┐
│  src/core/ + src/plugins/              │
│  JanusClient, SipPlugin,               │
│  StreamingPlugin                       │
│  (platform-agnostic, без DOM/jQuery)   │
└─────────────────┬──────────────────────┘
                  │ WebSocket / HTTP
┌─────────────────▼──────────────────────┐
│  Janus WebRTC Gateway                  │
│  (SIP Plugin, Streaming Plugin)        │
└────────────────────────────────────────┘
```

Модули `JanusClient`, `SipPlugin`, `StreamingPlugin` не зависят от DOM и могут быть переиспользованы в мобильном приложении (React Native) без изменений.

---

## Дорожная карта

- [x] **Фаза 1** — Инфраструктура: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`
- [x] **Фаза 2** — Модульная TypeScript-архитектура: типы, `JanusClient`, `SipPlugin`, `StreamingPlugin`, `helpers`
- [ ] **Фаза 3** — Web UI: переписать `streaming.html` / `sip.html` с использованием новых модулей
- [ ] **Фаза 4** — Мобильное приложение: React Native + `react-native-webrtc`
- [ ] **Фаза 5** — Тесты: Vitest unit-тесты для core и plugins
- [ ] **Фаза 6** — CI/CD: GitHub Actions (сборка, линт, тесты)
