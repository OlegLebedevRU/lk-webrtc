# Презентация решения: SIP/Video инфраструктура с lk-webrtc

## 1. Цель решения

Построить единую платформу голосовой и видеосвязи, где:
- контроллер **siplite** управляет SIP/видеотерминалами и подключенной IP-камерой;
- ядро **iot-rpc-rest-app** обеспечивает RPC/EVENT-взаимодействие контроллеров;
- личный кабинет **lk-leo4** предоставляет операторский и клиентский интерфейс;
- медиапотоки обрабатываются через **Janus**;
- SIP-сигнализация обслуживается **Asterisk**;
- абоненты используют типовые SIP-клиенты или **lk-webrtc**.

---

## 2. Компоненты системы

- **siplite**: контроллер на объекте, интеграция SIP и IP-камеры.
- **iot-rpc-rest-app**: RPC/EVENT ядро оркестрации и интеграции контроллеров.
- **lk-leo4**: личный кабинет (администрирование, мониторинг, управление).
- **Janus WebRTC Gateway**: медиа-шлюз для WebRTC и видеостриминга.
- **Asterisk**: SIP-сервер, регистрация абонентов, маршрутизация вызовов.
- **lk-webrtc / SIP-клиенты**: конечные клиентские приложения абонентов.

---

## 3. Высокоуровневая архитектура

```mermaid
flowchart TB
    Cam[IP-камера] --> Siplite[siplite контроллер]
    Siplite <--> Core[iot-rpc-rest-app\nRPC/EVENT ядро]
    Core <--> LK[lk-leo4\nЛичный кабинет]

    Siplite <--> Ast[Asterisk\nSIP-связь]
    Siplite <--> Janus[Janus\nMedia Server]
    Ast <--> Janus

    Janus <--> LKW[lk-webrtc]
    Ast <--> SIPC[Типовые SIP-клиенты]
    LK --> LKW
```

---

## 4. Логика голосового вызова (SIP)

```mermaid
sequenceDiagram
    participant U as Абонент (lk-webrtc/SIP-клиент)
    participant A as Asterisk
    participant S as siplite
    participant C as iot-rpc-rest-app
    participant L as lk-leo4

    U->>A: SIP REGISTER / INVITE
    A->>S: Маршрутизация вызова
    S-->>A: SIP 200 OK / media params
    A-->>U: Ответ вызова
    S->>C: EVENT о состоянии вызова
    C->>L: Публикация состояния в ЛК
```

---

## 5. Логика видеостриминга (WebRTC)

```mermaid
sequenceDiagram
    participant Cam as IP-камера
    participant S as siplite
    participant J as Janus
    participant W as lk-webrtc
    participant C as iot-rpc-rest-app

    Cam->>S: RTSP/видео поток
    S->>J: Публикация/проксирование потока
    W->>J: Запрос на просмотр (WebRTC)
    J-->>W: SDP/ICE + медиапоток
    S->>C: EVENT доступности/ошибок потока
```

---

## 6. Контур управления и событий

```mermaid
flowchart LR
    LK[lk-leo4] -->|REST/RPC команды| Core[iot-rpc-rest-app]
    Core -->|RPC| Siplite[siplite]
    Siplite -->|EVENT статусы| Core
    Core -->|EVENT/REST| LK
```

---

## 7. Роли и сценарии пользователей

- **Оператор/администратор (lk-leo4)**:
  - управление контроллерами и терминалами;
  - просмотр статусов и событий;
  - диагностика каналов связи.
- **Абонент**:
  - звонки через SIP-клиент или lk-webrtc;
  - просмотр видеопотоков через lk-webrtc.

---

## 8. Преимущества архитектуры

- Разделение сигнализации (**Asterisk**) и медиа (**Janus**).
- Масштабируемость по контроллерам и клиентам.
- Поддержка гибридного клиентского контура (SIP-клиенты + WebRTC).
- Централизованное управление и мониторинг через RPC/EVENT ядро и ЛК.
- Переиспользование существующих интеграций (siplite, iot-rpc-rest-app, lk-leo4).

---

## 9. Репозитории компонентов

- siplite: <https://github.com/OlegLebedevRU/siplite>
- iot-rpc-rest-app: <https://github.com/OlegLebedevRU/iot-rpc-rest-app>
- lk-leo4: <https://github.com/OlegLebedevRU/lk-leo4>
- lk-webrtc: <https://github.com/OlegLebedevRU/lk-webrtc>
