# DGLAB KIT

DGLAB KIT 是面向 **DG-LAB 4 APP** 的 TypeScript SDK。它可以在 Bun、Node.js、浏览器或其他 JavaScript 运行环境中，通过 WebSocket 与 DG-LAB 4 APP 配对，并控制 APP 暴露的本地设备。

SDK 当前主要提供两类能力：

- **Socket SDK**：连接 V3 / V4 WebSocket 中继服务，完成 APP 配对、设备发现、强度控制、波形下发、任务清理和自定义反馈接收。
- **Waveform SDK**：内置郊狼与负鼠波形数据，可直接作为 V3 / V4 波形下发参数使用。

> 推荐优先使用 V4 协议。V4 支持 `1 控制方 : N APP 被控方`，并提供设备列表、插槽状态增量、RPC 响应、HTTP 下发等能力。V3 仅用于兼容旧版控制端。

## 目录

- [运行要求](#运行要求)
- [安装](#安装)
- [核心概念](#核心概念)
- [快速开始：V4 控制 APP](#快速开始v4-控制-app)
- [生成 APP 配对二维码](#生成-app-配对二维码)
- [Socket SDK API](#socket-sdk-api)
- [V4 常用操作](#v4-常用操作)
- [HTTP 下发 V4 指令](#http-下发-v4-指令)
- [手动传输模式](#手动传输模式)
- [V3 旧协议](#v3-旧协议)
- [Waveform SDK](#waveform-sdk)
- [V4 协议参考](#v4-协议参考)
- [常见问题](#常见问题)

## 运行要求

- Node.js 22+。
- TypeScript 项目推荐启用 ES Module 或支持顶层 `await`；CommonJS 项目可以把示例代码包进 `async function main()`。
- 浏览器、React Native、小程序等环境如需自定义 WebSocket 实现，可使用 [手动传输模式](#手动传输模式)。

## 安装

在你的项目中安装 SDK：

```bash
# bun
bun add dglab-kit

# pnpm
pnpm add dglab-kit

# yarn
yarn add dglab-kit

# npm
npm install dglab-kit
```

## 核心概念

| 名称         | 说明                                                        |
|------------|-----------------------------------------------------------|
| 控制方        | 运行 `DglabSocket` 的一端，例如网页、Node.js 服务、移动端控制器               |
| APP 被控方    | DG-LAB 4 APP                                              |
| `targetId` | 控制方连接成功后获得的配对 ID。把它交给 APP，被控方才能接入当前控制方                    |
| `secret`   | 控制方连接成功后获得的 HTTP 鉴权密钥，对应 V4 `hello.apikey`                |
| `clientId` | V4 中某个 APP 被控方的连接 ID。控制方给指定 APP 下发指令时必须传入它                |
| `slotId`   | APP 暴露的设备插槽 ID。所有设备操作都通过 `slotId` 定位设备                    |
| `channel`  | 设备通道。V4 使用 `V4Channel.A` / `V4Channel.B`，协议值分别是 `0` / `1` |

V4 的连接关系如下：

```text
APP 1 ──┐
APP 2 ──┼──── ws ──── server_v4.js ◄──── ws ──── 控制方 DglabSocket
APP 3 ──┘
```

控制方只需要连接中继服务器；APP 使用控制方的 `targetId` 接入。接入成功后，APP 会主动上报一次 `devices.snapshot`，之后通过 `devices.patch` 和 `slots.patch` 发送增量。

## 快速开始：V4 控制 APP

下面示例完成一条完整链路：连接 V4 中继服务器，拿到配对 ID，等待 APP 接入，读取设备，调整 A 通道强度，下发内置波形，然后清理任务。

```ts
import {
  COYOTE_WAVEFORM,
  COYOTE_WAVEFORMS,
  DglabSocket,
  V4Channel,
} from 'dglab-kit';

const socket = new DglabSocket({ url: 'ws://127.0.0.1:9998' });

socket.on('state', (state, previous) => {
  console.log('socket state:', previous, '->', state);
});

socket.on('devices', (devices, clientId) => {
  console.log('设备列表更新:', clientId, devices);
});

socket.on('device', (device, clientId) => {
  console.log('单设备变化:', clientId, device);
});

socket.on('action', (action) => {
  console.log('APP 自定义动作:', action);
});

const { targetId, secret } = await socket.connect();

console.log('请将这个 APP 配对 ID 交给 DG-LAB 4 APP:', targetId);
console.log('HTTP 鉴权密钥:', secret);

socket.on('client-attached', async (clientId) => {
  console.log('APP 接入:', clientId);

  const { devices } = await socket.requestDevices(clientId);
  const slotId = devices[0]?.slotId;
  if (!slotId) {
    console.log('当前 APP 没有暴露设备');
    return;
  }

  await socket.resetIntensity(clientId, slotId, V4Channel.A);
  await socket.addIntensity(clientId, slotId, V4Channel.A, 5);
  await socket.setTempIntensity(clientId, slotId, V4Channel.A, 30, 3000);

  await socket.sendPulse(
    clientId,
    slotId,
    V4Channel.A,
    1000,
    COYOTE_WAVEFORMS[COYOTE_WAVEFORM.BUBBLE].raw,
  );

  await socket.clearOperate(clientId, { slotId, channel: V4Channel.A });
});
```

## 生成 APP 配对二维码

V4 协议支持任意 URL Path。通常可以把控制方 `targetId` 放进 URL Query 中，再生成二维码给 APP 扫描或通过浏览器跳转到 DG-LAB 4 APP。
需要注意在 V4 协议中 URL Query 使用 `tid` 而不是 `targetId`。

```ts
const appSocketUrl = `wss://ws.dungeon-lab.cn/?tid=${targetId}`;

const qrcode = `https://dungeon-lab.cn/s/?v=1&action=socket&url=${encodeURIComponent(appSocketUrl)}`;
```

如果你使用自部署服务器，请把 `wss://ws.dungeon-lab.cn/` 换成自己的 V4 WebSocket 地址。

## Socket SDK API

### 构造函数

```ts
import { DglabSocket } from 'dglab-kit';

const socket = new DglabSocket(options);
```

| 选项                | 类型                     | 默认值                       | 说明                         |
|-------------------|------------------------|---------------------------|----------------------------|
| `url`             | `string`               | 无                         | WebSocket 服务地址。省略时进入手动传输模式 |
| `protocols`       | `string \| string[]`   | 无                         | WebSocket 子协议              |
| `connectTimeout`  | `number`               | `8000`                    | 等待连接完成的超时时间，单位 ms          |
| `responseTimeout` | `number`               | `8000`                    | V4 等待 RPC 响应的默认超时时间，单位 ms  |
| `version`         | `DGLAB_SOCKET_VERSION` | `DGLAB_SOCKET_VERSION.V4` | 协议版本                       |

### `connect()` 返回值

```ts
const { targetId, secret } = await socket.connect();
```

| 字段         | 说明                                  |
|------------|-------------------------------------|
| `targetId` | 当前控制方 ID。APP 被控方需要使用它接入。            |
| `secret`   | HTTP 下发接口鉴权密钥，即协议中的 `hello.apikey`。 |

### Socket 状态

```ts
import type { DGLAB_SOCKET_STATE } from 'dglab-kit';
```

| 状态                                  | 说明             |
|-------------------------------------|----------------|
| `DGLAB_SOCKET_STATE.Idle`           | 未连接            |
| `DGLAB_SOCKET_STATE.Connecting`     | 正在连接 WebSocket |
| `DGLAB_SOCKET_STATE.WaitingForPeer` | 已连接，等待 APP 接入  |
| `DGLAB_SOCKET_STATE.Paired`         | 已配对，可下发控制指令    |
| `DGLAB_SOCKET_STATE.Disconnected`   | 已断开            |

### 通用事件

| 事件                    | 回调                            | 说明                                                 |
|-----------------------|-------------------------------|----------------------------------------------------|
| `state`               | `(state, previous) => void`   | Socket 状态变化                                        |
| `open`                | `(event) => void`             | WebSocket 已打开                                      |
| `close`               | `(event) => void`             | WebSocket 已关闭                                      |
| `error`               | `(error) => void`             | 连接或协议错误                                            |
| `message`             | `(data, raw) => void`         | 收到原始消息文本                                           |
| `frame`               | `(frame) => void`             | 收到已解析协议帧                                           |
| `data`                | `(data, clientId?) => void`   | 收到 APP 上行数据                                        |
| `action`              | `(action) => void`            | APP 自定义动作。V4 来自 `custom.action`，V3 来自 `feedback-*` |
| `device`              | `(device, clientId) => void`  | 单设备事件；新增为完整数据，更新为增量                                |
| `devices`             | `(devices, clientId) => void` | V4 当前完整设备列表更新                                      |
| `client-attached`     | `(clientId) => void`          | APP 接入                                             |
| `client-disconnected` | `(clientId) => void`          | APP 断开                                             |

### V4 属性与方法

V4 支持多个 APP 同时接入，因此所有面向 APP 的方法都需要传入目标 APP 的 `clientId`。

| API                                                                      | 说明                   |
|--------------------------------------------------------------------------|----------------------|
| `targetId`                                                               | 当前控制方 ID，连接成功后可用     |
| `secret`                                                                 | HTTP 鉴权密钥，连接成功后可用    |
| `clientIds`                                                              | 已接入 APP ID 列表        |
| `clients`                                                                | 已接入 APP 状态列表         |
| `getClient(clientId)`                                                    | 获取指定 APP 状态          |
| `ping(clientId, options?)`                                               | 请求 APP 响应，返回链路延迟 ms  |
| `requestDevices(clientId)`                                               | 请求 APP 当前设备列表        |
| `send(clientId, data, options?)`                                         | 发送自定义 V4 RPC 或应用层消息  |
| `resetIntensity(clientId, slotId, channel, options?)`                    | 将指定通道强度设置为 `0`       |
| `addIntensity(clientId, slotId, channel, value, options?)`               | 增加强度                 |
| `reduceStrength(clientId, slotId, channel, value, options?)`             | 减少强度                 |
| `setTempIntensity(clientId, slotId, channel, value, duration, options?)` | 设置临时强度，任务结束后自动回到 `0` |
| `sendPulse(clientId, slotId, channel, duration, frames, options?)`       | 下发波形帧                |
| `clearPulse(clientId, slotId, channel)`                                  | 清理指定设备通道波形           |
| `clearOperate(clientId, options?)`                                       | 清理任务；可清理全部、指定设备或指定通道 |

### V4 操作选项

| 选项          | 说明                           |
|-------------|------------------------------|
| `timeout`   | 本次指令等待响应的超时时间，单位 ms          |
| `priority`  | 任务优先级，`0 \| 1 \| 2`，默认由协议端决定 |
| `immediate` | 是否替换同设备、同通道、同类型的已有任务         |

## V4 常用操作

### 请求设备列表

```ts
const { devices } = await socket.requestDevices(clientId);

for (const device of devices) {
  console.log(device.slotId, device.name, device.type);
}
```

设备出现在 `devices.snapshot`、`devices.get` 或 `devices.patch.added` 后即可直接操作，不需要对 slot 额外发送连接指令。

### 探测 APP 链路延迟

```ts
const rtt = await socket.ping(clientId);
console.log('RTT:', rtt, 'ms');
```

### 强度控制

```ts
await socket.resetIntensity(clientId, slotId, V4Channel.A);
await socket.addIntensity(clientId, slotId, V4Channel.A, 5);
await socket.reduceStrength(clientId, slotId, V4Channel.B, 3);
```

### 临时强度

```ts
await socket.setTempIntensity(
  clientId,
  slotId,
  V4Channel.A,
  30,   // 临时强度
  3000, // 持续时间，单位 ms
);
```

### 下发波形

```ts
import { COYOTE_WAVEFORM, COYOTE_WAVEFORMS, V4Channel } from 'dglab-kit';

const frames = COYOTE_WAVEFORMS[COYOTE_WAVEFORM.BUBBLE].raw;

await socket.sendPulse(
  clientId,
  slotId,
  V4Channel.A,
  1000,
  frames,
);
```

### 清理任务

```ts
// 清理某个 APP 的全部任务
await socket.clearOperate(clientId);

// 清理指定设备的全部通道
await socket.clearOperate(clientId, { slotId });

// 清理指定设备的指定通道
await socket.clearOperate(clientId, { slotId, channel: V4Channel.A });
```

### 发送自定义 RPC

SDK 未封装的 V4 协议能力可以通过 `send()` 下发。例如协议支持 `SetMute`，如果你的 SDK 版本没有提供专用方法，可以直接发送 `device.op`：

```ts
await socket.send(clientId, {
  t: 'req',
  reqId: crypto.randomUUID(),
  m: 'device.op',
  data: {
    s: slotId,
    t: 5,
    c: V4Channel.A,
    p: 1,
    v: true,
  },
});
```

## HTTP 下发 V4 指令

V4 Socket 服务器支持通过 HTTP 下发和 WebSocket 相同的 RPC 请求。HTTP 适合服务端定时任务、Webhook、后台管理系统等场景；它不支持订阅或接收 APP 主动上报事件。

请求头使用控制方 `connect()` 返回的 `secret`：

```http
POST /v4/message
apikey: http-apikey
content-type: application/json

{
  "type": "message",
  "clientId": "controlled-client-id",
  "data": { "t": "req", "reqId": "req-1", "m": "devices.get" }
}
```

HTTP 接口规则：

| 项目      | 说明                                                                                |
|---------|-----------------------------------------------------------------------------------|
| 路径      | `POST /message` 和 `POST /v4/message` 都可用                                          |
| 鉴权      | Header `apikey`；也兼容 `x-apikey`。值为控制方 `hello.apikey`，即 SDK 的 `secret`              |
| Body    | `{ type: 'message', clientId, data }`，其中 `data.t` 必须是 `'req'`                     |
| CORS 预检 | `OPTIONS` 返回 `200 { "ok": true }`                                                 |
| 成功      | `200 { "ok": true, "result": <RPC result> }`                                      |
| RPC 错误  | `200 { "ok": false, "error": "..." }`                                             |
| 未鉴权     | `401 { "ok": false, "error": "unauthorized" }`                                    |
| 请求体非法   | `400 { "ok": false, "error": "bad_request" }`                                     |
| JSON 非法 | `400 { "ok": false, "error": "invalid_json" }`                                    |
| Body 过大 | `400 { "ok": false, "error": "body_too_large" }`                                  |
| 路径不存在   | `404 { "ok": false, "error": "not_found" }`                                       |
| 方法不支持   | `405 { "ok": false, "error": "method_not_allowed" }`                              |
| APP 不存在 | `404 { "ok": false, "error": "client_not_found" }`                                |
| 重复请求    | `409 { "ok": false, "error": "duplicate_request" }`                               |
| 等待超时    | `504 { "ok": false, "error": "request_timeout" }`                                 |
| 等待期间断开  | `504 { "ok": false, "error": "client_disconnected" }` 或 `controller_disconnected` |

HTTP body 最大约 1 MiB。服务器会等待同一 APP 被控方返回相同 `reqId` 的 RPC 响应，等待时间约 30 秒。

## 手动传输模式

不传 `url` 时，SDK 不会主动创建 WebSocket。你可以绑定自己的传输实现，并把 WebSocket 生命周期事件转交给 SDK。

```ts
import { DglabSocket } from 'dglab-kit';

const socket = new DglabSocket();
const ws = new WebSocket('ws://127.0.0.1:9998');

socket.setSender((data) => ws.send(data));

ws.addEventListener('open', (event) => socket.handleOpen(event));
ws.addEventListener('message', (event) => socket.handleMessage(event.data));
ws.addEventListener('close', (event) => socket.handleClose(event));
ws.addEventListener('error', (event) => socket.handleError(event));

const { targetId } = await socket.connect();
console.log(targetId);
```

手动传输模式适用于浏览器、React Native、小程序或任何需要自定义 WebSocket 实现的运行环境。

## V3 旧协议

V3 为旧协议，使用 `DGLAB_SOCKET_VERSION.V3` 显式开启。V3 只维护一个 APP 配对关系，适合兼容旧版控制端。

```ts
import {
  COYOTE_WAVEFORM,
  COYOTE_WAVEFORMS,
  DGLAB_SOCKET_VERSION,
  DglabSocket,
  V3Channel,
} from 'dglab-kit';

const socket = new DglabSocket({
  version: DGLAB_SOCKET_VERSION.V3,
  url: 'wss://ws.dungeon-lab.cn/',
});

const { targetId } = await socket.connect();
console.log('将控制方 ID 交给 APP:', targetId);

socket.on('client-attached', () => {
  socket.setStrength(V3Channel.A, 20);
  socket.addStrength(V3Channel.A, 3);
  socket.reduceStrength(V3Channel.B, 1);

  socket.sendPulse({
    channel: 'A',
    time: 5,
    data: COYOTE_WAVEFORMS[COYOTE_WAVEFORM.BUBBLE].raw,
  });
});

socket.on('action', (action) => {
  console.log('APP 按钮反馈:', action);
});
```

### V3 方法

| API                              | 说明               |
|----------------------------------|------------------|
| `targetId`                       | 当前控制方 ID，连接成功后可用 |
| `pairedClientId`                 | 已配对 APP ID       |
| `send(data)`                     | 发送旧协议自定义数据       |
| `addStrength(channel, step?)`    | 增加强度             |
| `reduceStrength(channel, step?)` | 减少强度             |
| `setStrength(channel, strength)` | 设置强度             |
| `sendPulse(options)`             | 下发波形             |
| `clearPulse(channel)`            | 清空通道波形           |

V3 的强度和清理方法中，`channel` 使用 `V3Channel.A` 或 `V3Channel.B`。

V3 的 `sendPulse` 参数为 `{ channel, time, data }`：

| 字段        | 说明                   |
|-----------|----------------------|
| `channel` | 波形通道，`'A'` 或 `'B'`   |
| `time`    | 持续时间，单位秒             |
| `data`    | 波形帧 JSON 字符串或十六进制帧列表 |

## Waveform SDK

内置波形包含郊狼与负鼠两组数据。

```ts
import {
  COYOTE_WAVEFORM,
  COYOTE_WAVEFORMS,
  OVC_WAVEFORM,
  OVC_WAVEFORMS,
} from 'dglab-kit';

const coyoteBubble = COYOTE_WAVEFORMS[COYOTE_WAVEFORM.BUBBLE];
console.log(coyoteBubble.label.cn);
console.log(coyoteBubble.raw);

const ovcAlarm = OVC_WAVEFORMS[OVC_WAVEFORM.ALARM];
console.log(ovcAlarm.label.en);
console.log(ovcAlarm.raw);
```

每个波形条目的结构如下：

```ts
{
  label: {
    cn: string;
    en: string;
  };
  raw: string[];
}
```

`raw` 是十六进制波形帧列表，可直接作为 V3 `sendPulse({ data })` 的 `data`，也可作为 V4 `sendPulse(clientId, ..., frames, ...)` 的 `frames`。

```ts
const frames = COYOTE_WAVEFORMS[COYOTE_WAVEFORM.BUBBLE].raw;

socketV3.sendPulse({
  channel: 'A',
  time: 5,
  data: frames,
});

await socketV4.sendPulse(clientId, slotId, V4Channel.A, 1000, frames);
```

## V4 协议参考

这一节用于调试、跨语言实现或直接对接 V4 WebSocket / HTTP 协议。如果你只使用 `DglabSocket` 的封装方法，可以优先阅读前面的快速开始和 API 部分。

<details>
<summary>V4 连接流程、服务器帧、心跳和关闭码</summary>

### 控制方连接

控制方直接连接服务器：

```text
ws://host:9998
```

连接成功后，服务器返回：

```json
{ "type": "hello", "clientId": "controller-client-id", "apikey": "http-apikey" }
```

控制方保存 `clientId` 和 `apikey`。被控方需要使用这个 `clientId` 作为 `targetId` 接入；`apikey` 用于 HTTP 接口鉴权。

当有 APP 被控方接入时，控制方收到：

```json
{ "type": "client_attached", "clientId": "controlled-client-id" }
```

当 APP 被控方断开时，控制方收到：

```json
{ "type": "client_disconnected", "clientId": "controlled-client-id" }
```

控制方应以 APP 的 `clientId` 为 key 维护被控方列表。后续所有发给某个 APP 的应用层消息，都需要在服务器帧中携带目标 `clientId`。

### APP 被控方连接

APP 被控方通过控制方的 `clientId` 建立连接：

```text
ws://host:9998?targetId=<controller-client-id>
```

连接成功后，服务器向 APP 被控方发送：

```json
{ "type": "hello", "clientId": "controlled-client-id", "apikey": "http-apikey" }
{ "type": "controller_attached", "clientId": "controller-client-id" }
```

收到 `controller_attached` 后，APP 被控方应立即通过 `devices.snapshot` 上传当前全部设备信息。控制方断开时，APP 被控方会收到：

```json
{ "type": "controller_disconnected", "clientId": "controller-client-id" }
```

随后服务器关闭 APP 被控方连接。

### 通用服务器帧

| `type`                    | 方向            | 含义                                 |
|---------------------------|---------------|------------------------------------|
| `hello`                   | 服务器 → 客户端     | 分配当前连接的 `clientId` 和 HTTP `apikey` |
| `client_attached`         | 服务器 → 控制方     | APP 被控方接入                          |
| `client_disconnected`     | 服务器 → 控制方     | APP 被控方断开                          |
| `controller_attached`     | 服务器 → APP 被控方 | APP 已挂载到控制方                        |
| `controller_disconnected` | 服务器 → APP 被控方 | 控制方断开，随后 APP 连接会关闭                 |
| `heartbeat`               | 服务器 → 客户端     | 服务器心跳，通常每 30 秒一次                   |
| `ping`                    | 客户端 → 服务器     | 服务器级连接探测，不转发给对端                    |
| `pong`                    | 服务器 → 客户端     | 对 `ping` 的响应，可携带 `ts` 时间戳          |
| `message`                 | 控制方 ↔ APP 被控方 | 透传应用层消息                            |
| `idle_timeout`            | 服务器 → 控制方     | 控制方空闲超时，随后连接会关闭                    |
| `error`                   | 服务器 → 客户端     | 服务器错误，例如 `controller_not_found`    |

### 空闲超时

如果控制方连接后 5 分钟内没有任何 APP 被控方连接，服务器会发送：

```json
{ "type": "idle_timeout" }
```

随后服务器主动关闭控制方连接。当所有 APP 被控方都断开后，服务器也会重新开始这 5 分钟空闲计时。

### 心跳与服务器级 ping

服务器每 30 秒发送一次：

```json
{ "type": "heartbeat" }
```

客户端收到后无需回复。客户端也可以主动发送服务器级 ping：

```json
{ "type": "ping" }
```

服务器返回：

```json
{ "type": "pong", "ts": 1710000000123 }
```

这是客户端到 V4 Socket 服务器的探测，不会转发给对端。

### WebSocket 关闭码

| Close Code | Reason                    | 方向        | 含义                  |
|------------|---------------------------|-----------|---------------------|
| `4000`     | `controller_disconnected` | APP 被控方收到 | 控制方断开，APP 被控方被踢下线   |
| `4001`     | `controller_not_found`    | APP 被控方收到 | `targetId` 对应控制方不存在 |
| `4002`     | `idle_timeout`            | 控制方收到     | 控制方空闲超时             |

普通正常关闭不使用 4000+ 业务状态码。

</details>

<details>
<summary>V4 Message 外层帧与 APP 消息</summary>

### 控制方发送给指定 APP

控制方发送应用层消息时，外层服务器帧固定为：

```json
{
  "type": "message",
  "clientId": "controlled-client-id",
  "data": {}
}
```

| 字段         | 说明                     |
|------------|------------------------|
| `type`     | 固定为 `'message'`        |
| `clientId` | 目标 APP 被控方的 `clientId` |
| `data`     | 应用层消息，见下文 `t` 协议       |

### 控制方接收 APP 消息

APP 被控方上报的应用层消息由服务器补充来源 `clientId`：

```json
{
  "type": "message",
  "clientId": "controlled-client-id",
  "data": {}
}
```

控制方根据外层 `clientId` 判断消息来自哪个 APP。

### APP 消息类型

APP 消息位于外层 `message.data` 中，统一携带 `t` 字段。

| `t`    | 说明                    |
|--------|-----------------------|
| `req`  | 控制方发给 APP 被控方的 RPC 请求 |
| `resp` | APP 被控方返回的 RPC 响应     |
| `ev`   | APP 被控方主动上报的事件        |

RPC 请求字段：

| 字段      | 类型       | 必填 | 说明                                |
|---------|----------|----|-----------------------------------|
| `t`     | `'req'`  | 是  | 固定值，表示 RPC 请求                     |
| `reqId` | `string` | 是  | 请求 ID，用于匹配响应；同一 APP 被控方的未完成请求不应重复 |
| `m`     | `string` | 是  | RPC 方法名                           |
| `data`  | `object` | 否  | RPC 参数，不同方法结构不同                   |

RPC 响应字段：

| 字段       | 类型        | 必填 | 说明                      |
|----------|-----------|----|-------------------------|
| `t`      | `'resp'`  | 是  | 固定值，表示 RPC 响应           |
| `reqId`  | `string`  | 是  | 对应请求的 `reqId`           |
| `result` | `unknown` | 否  | 成功结果；和 `error` 二选一      |
| `error`  | `string`  | 否  | 错误码或错误原因；和 `result` 二选一 |

常用 RPC 方法：

| 方法                | `data` 类型       | `result` 类型                   | 说明                                    |
|-------------------|-----------------|-------------------------------|---------------------------------------|
| `devices.get`     | 无               | `{ devices: RemoteDevice[] }` | 获取 APP 被控方当前暴露的设备列表                   |
| `ping`            | 无               | `number`                      | 探测控制方到 APP 的链路；结果为 APP 收到 ping 的本地时间戳 |
| `device.op`       | `DeviceOperate` | `DeviceOperateResult`         | 下发设备操作任务                              |
| `device.op.clear` | `ClearOperate`  | `{}`                          | 清理全部、指定设备或指定通道的任务                     |

</details>

<details>
<summary>V4 设备模型与事件</summary>

### 设备描述结构

`devices.get`、`devices.snapshot` 和 `devices.patch` 会使用设备描述结构。

| 字段          | 类型       | 必填 | 说明                    |
|-------------|----------|----|-----------------------|
| `id`        | `number` | 否  | 设备序号；某些响应可能携带         |
| `slotId`    | `string` | 是  | 设备真实插槽 ID，设备操作使用它定位设备 |
| `name`      | `string` | 是  | 设备或插槽展示名称             |
| `type`      | `string` | 是  | 设备类型，例如 `COYOTE_030`  |
| `props`     | `object` | 否  | 当前设备属性快照，完整设备信息中使用    |
| `slotState` | `object` | 否  | 当前插槽状态快照，完整设备信息中使用    |

`devices.snapshot.devices[]` 和 `devices.patch.added[]` 中的 `props`、`slotState` 是当前完整快照；`slots.patch.slots[]` 中的 `props`、`slotState` 是增量，只包含本 tick 发生变化的字段。控制方应按 `slotId` 对本地缓存做深合并。

### `devices.snapshot`

APP 被控方连接成功后立即上报当前全部设备；即使没有设备，`devices` 也会作为空数组发送。

```json
{
  "t": "ev",
  "ev": "devices.snapshot",
  "devices": [
    {
      "id": 0,
      "slotId": "slot-a",
      "name": "设备 A",
      "type": "COYOTE_030",
      "props": {},
      "slotState": {
        "markLight": "yellow",
        "hasDevice": true
      }
    }
  ]
}
```

控制方收到后应使用 `devices` 替换该 APP 的本地设备列表。

### `devices.patch`

APP 被控方会在设备列表变化时主动上报增量。

```json
{
  "t": "ev",
  "ev": "devices.patch",
  "added": [
    {
      "id": 2,
      "slotId": "slot-c",
      "name": "设备 C",
      "type": "COYOTE_030",
      "props": {},
      "slotState": {
        "markLight": "yellow",
        "hasDevice": true
      }
    }
  ],
  "removed": ["slot-a"]
}
```

| 字段        | 说明                                 |
|-----------|------------------------------------|
| `added`   | 新增设备的完整信息，包含 `props` 和 `slotState` |
| `removed` | 被移除设备的字符串 `slotId`                 |

控制方收到 `devices.patch` 后直接更新本地设备列表，不需要重新请求全量列表。

### `slots.patch`

APP 被控方会按 tick 合并插槽状态并上报。

```json
{
  "t": "ev",
  "ev": "slots.patch",
  "slots": [
    {
      "slotId": "slot-a",
      "props": { "strength": 10 },
      "slotState": { "markLight": "green" }
    }
  ]
}
```

控制方以字符串 `slotId` 更新对应设备状态。

### `custom.action`

APP 被控方可以主动向控制方发送 `0` 到 `9` 的自定义动作。

```json
{ "t": "ev", "ev": "custom.action", "action": 7 }
```

控制方应校验 `action` 是 `0` 到 `9` 的整数。

</details>

<details>
<summary>V4 设备操作 RPC</summary>

设备操作通过 `device.op` 下发。控制方不需要传内部任务 ID；APP 被控方会使用外层 RPC `reqId` 作为任务 ID。

```json
{
  "t": "req",
  "reqId": "req-2",
  "m": "device.op",
  "data": {
    "s": "slot-a",
    "t": 0,
    "c": 0,
    "p": 1,
    "d": 1000,
    "v": ["0A0A0A0A00000000"]
  }
}
```

### `DeviceOperate` 通用字段

| 字段   | 类型            | 必填 | 说明                   |
|------|---------------|----|----------------------|
| `s`  | `string`      | 是  | 设备的字符串 `slotId`      |
| `t`  | `number`      | 是  | `ActionType`，见下表     |
| `c`  | `0 \| 1`      | 是  | 通道，`0` = A，`1` = B   |
| `p`  | `0 \| 1 \| 2` | 否  | 优先级，默认 `1`           |
| `d`  | `number`      | 否  | 持续时间，单位 ms，默认 `0`    |
| `im` | `boolean`     | 否  | 是否替换同设备、同通道、同类型的已有任务 |

### 调度规则

- 不同设备、通道、任务类型和优先级分别调度。
- 相同设备、通道、任务类型和优先级按队列执行。
- 同一 tick 连续入队的 oneShot 会在该 tick 一次执行完。
- `im: true` 会先替换同设备、通道、任务类型的已有任务。
- 对持续任务来说，`d: 0` 表示不按持续时间自动结束；`AppendPulseData` 仍会在帧列表消费完后完成。

### 可用 `ActionType`

| `t` | 操作类型               | 额外字段                | 生命周期    | SDK 封装方法                          |
|-----|--------------------|---------------------|---------|-----------------------------------|
| `0` | `AppendPulseData`  | `v`, `ver?`, `seq?` | 持续任务    | `sendPulse`                       |
| `3` | `AddIntensity`     | `v`                 | oneShot | `addIntensity` / `reduceStrength` |
| `4` | `SetTempIntensity` | `v`                 | 持续任务    | `setTempIntensity`                |
| `5` | `SetMute`          | `v`                 | oneShot | 可通过 `send()` 下发                   |
| `7` | `SetIntensity`     | `v`                 | oneShot | `resetIntensity`                  |

`ActionType.AppendPulse` (`t: 1`)、`ActionType.ClearPulse` (`t: 2`) 和 `ActionType.SetVar` (`t: 6`) 保留在枚举中，但当前 APP 被控方没有注册对应 JSON task 实现；通过 `device.op` 下发会返回 `invalid_operate`。清理波形或任务请使用 `device.op.clear`。

### `AppendPulseData` (`t: 0`)

向指定通道推送波形数据。每个 tick 消费 `v` 中的一帧，tick 间隔通常为 100ms。

| 字段    | 类型                       | 说明                             |
|-------|--------------------------|--------------------------------|
| `d`   | `number`                 | 最长播放时间，单位 ms                   |
| `v`   | `number[][] \| string[]` | 裸波形帧列表；字符串使用十六进制字节格式           |
| `ver` | `number`                 | 可选。`2` 使用 V2 波形帧；省略或 `3` 使用 V3 |
| `seq` | `number`                 | 可选。兼容旧协议的帧序列号                  |

波形帧格式：

| `ver` | 单帧格式                               |
|-------|------------------------------------|
| `2`   | `[a, b, interval]`                 |
| `3`   | `[a1, a2, a3, a4, b1, b2, b3, b4]` |

十六进制字符串必须由完整字节对组成，例如 `0A0A0A0A00000000`。SDK 使用内置波形时会直接提供合法的十六进制帧列表。

### `AddIntensity` (`t: 3`)

对指定通道做相对强度调整。`v` 可以为正数或负数。

```json
{
  "t": "req",
  "reqId": "req-10",
  "m": "device.op",
  "data": {
    "s": "slot-a",
    "t": 3,
    "c": 0,
    "p": 1,
    "v": 5
  }
}
```

### `SetTempIntensity` (`t: 4`)

设置指定通道的临时强度。任务结束时，APP 被控方会自动把该临时强度重置为 `0`。

```json
{
  "t": "req",
  "reqId": "req-12",
  "m": "device.op",
  "data": {
    "s": "slot-a",
    "t": 4,
    "c": 0,
    "p": 1,
    "d": 3000,
    "v": 30
  }
}
```

### `SetMute` (`t: 5`)

设置指定通道的静音状态。

```json
{
  "t": "req",
  "reqId": "req-13",
  "m": "device.op",
  "data": {
    "s": "slot-a",
    "t": 5,
    "c": 0,
    "p": 1,
    "v": true
  }
}
```

| 字段  | 类型        | 说明                     |
|-----|-----------|------------------------|
| `v` | `boolean` | `true` 静音，`false` 取消静音 |

### `SetIntensity` (`t: 7`)

将指定通道的绝对强度设置为 `0`。V4 协议不接受其他目标值。

```json
{
  "t": "req",
  "reqId": "req-11",
  "m": "device.op",
  "data": {
    "s": "slot-a",
    "t": 7,
    "c": 1,
    "p": 1,
    "v": 0
  }
}
```

### `device.op` 响应

`device.op` 不会在入队成功时立刻响应；APP 被控方会等任务完成、被清理、被替换或连接断开取消后，才返回 RPC 响应。

```json
{
  "t": "resp",
  "reqId": "req-2",
  "result": {
    "type": 7,
    "reason": "completed",
    "slotId": "slot-a",
    "channel": 1
  }
}
```

| 字段        | 类型                                                      | 说明                   |
|-----------|---------------------------------------------------------|----------------------|
| `type`    | `ActionType`                                            | 已结束的任务类型             |
| `reason`  | `'completed' \| 'cleared' \| 'replaced' \| 'cancelled'` | 结束原因                 |
| `slotId`  | `string`                                                | 任务所属设备 `slotId`，可能省略 |
| `channel` | `0 \| 1`                                                | 任务所属通道，可能省略          |

常见 RPC 错误：

| `error`                | 触发条件                                      |
|------------------------|-------------------------------------------|
| `duplicate_request_id` | 同一个 APP 被控方已有未完成 `device.op` 使用相同 `reqId` |
| `invalid_params`       | `data` 不是对象，或 `device.op.clear` 参数非法      |
| `slot_not_found`       | `s` 缺失或对应设备不存在                            |
| `invalid_operate`      | task 字段不符合 schema，或 task 类型当前不支持          |
| `method_not_found`     | RPC 方法不是当前实现支持的方法                         |
| `internal_error`       | APP 被控方处理请求时抛出未预期异常                       |

### `device.op.clear`

清理所有设备的全部任务：

```json
{ "t": "req", "reqId": "req-3", "m": "device.op.clear" }
```

清理单个设备的全部通道：

```json
{ "t": "req", "reqId": "req-4", "m": "device.op.clear", "data": { "s": "slot-a" } }
```

清理单个设备的指定通道：

```json
{ "t": "req", "reqId": "req-5", "m": "device.op.clear", "data": { "s": "slot-a", "c": 0 } }
```

`device.op.clear` 成功时返回空对象 `{}`。清理已经入队且带有 RPC `reqId` 的任务时，那些任务也会分别收到 `reason: 'cleared'` 的 `device.op` 响应。`data.c` 只能和 `data.s` 一起使用；只传 `{ "c": 0 }` 会返回 `invalid_params`。

</details>

<details>
<summary>V4 设备 props / slotState 字段参考</summary>

### 通用 `slotState`

所有设备都会提供以下插槽状态字段：

| 字段          | 类型                                                                     | 说明                         |
|-------------|------------------------------------------------------------------------|----------------------------|
| `markLight` | `'yellow' \| 'green' \| 'red' \| 'purple' \| 'blue' \| 'cyan' \| null` | 设备灯颜色；未设置时通常回退为 `'yellow'` |
| `hasDevice` | `boolean`                                                              | 插槽当前是否有真实设备连接              |

### Coyote V2 / Coyote V3 `props`

适用设备类型：`COYOTE_020`、`COYOTE_030`。

| 字段             | 类型       | 说明                                       |
|----------------|----------|------------------------------------------|
| `power`        | `number` | 电量，范围通常为 `0` 到 `100`                     |
| `version`      | `number` | 设备版本                                     |
| `label`        | `number` | 设备标签                                     |
| `intensityA`   | `number` | A 通道当前强度                                 |
| `intensityB`   | `number` | B 通道当前强度                                 |
| `connectState` | `string` | 连接状态，例如 `'connected'` / `'disconnected'` |

`COYOTE_030` 额外包含：

| 字段               | 类型                      | 说明                                                             |
|------------------|-------------------------|----------------------------------------------------------------|
| `channelAStatus` | `0 \| 1 \| 2 \| 3 \| 4` | A 通道输出状态：`0` 无输出/输出过低无法检测，`1` 未形成回路，`2` 输出正常，`3` 输出损坏，`4` 通道屏蔽 |
| `channelBStatus` | `0 \| 1 \| 2 \| 3 \| 4` | B 通道输出状态，同 `channelAStatus`                                    |
| `updateValue`    | `string`                | 设备上报的更新值                                                       |

### Coyote V2 / Coyote V3 `slotState`

适用设备类型：`COYOTE_020`、`COYOTE_030`。`channelA` 和 `channelB` 结构相同：

| 字段                                                                                | 类型                      | 说明                                    |
|-----------------------------------------------------------------------------------|-------------------------|---------------------------------------|
| `channelA.isMuted` / `channelB.isMuted`                                           | `boolean`               | 对应通道是否静音                              |
| `channelA.warmUpScale` / `channelB.warmUpScale`                                   | `number`                | 冷启动系数，范围通常为 `0` 到 `1`                 |
| `channelA.intensityMax` / `channelB.intensityMax`                                 | `number`                | 当前最大强度上限，由 `comfortLimit` 参数计算得出      |
| `channelA.comfortLimit.mode` / `channelB.comfortLimit.mode`                       | `'simple' \| 'complex'` | 舒适强度限制模式                              |
| `channelA.comfortLimit.comfortMax` / `channelB.comfortLimit.comfortMax`           | `number`                | 舒适强度上限                                |
| `channelA.comfortLimit.absoluteMax` / `channelB.comfortLimit.absoluteMax`         | `number`                | 绝对强度上限                                |
| `channelA.comfortLimit.overheat` / `channelB.comfortLimit.overheat`               | `boolean`               | 是否处于过热状态                              |
| `channelA.comfortLimit.overheatPercent` / `channelB.comfortLimit.overheatPercent` | `number`                | 过热强度百分比                               |
| `channelA.comfortLimit.autoIncr` / `channelB.comfortLimit.autoIncr`               | `boolean`               | 是否启用强度上限自适应                           |
| `channelA.comfortLimit.autoIncrMax` / `channelB.comfortLimit.autoIncrMax`         | `number`                | 自适应最大增量                               |
| `channelA.comfortLimit.autoIncrScope` / `channelB.comfortLimit.autoIncrScope`     | `1 \| 2 \| 3`           | 自适应应用范围：`1` 仅舒适上限，`2` 仅绝对上限，`3` 两者都应用 |
| `channelA.comfortLimit.totalIncr` / `channelB.comfortLimit.totalIncr`             | `number`                | 当前累计自适应增量                             |

### OVC V1 `props`

适用设备类型：`OVC_1`。

| 字段               | 类型                 | 说明                                          |
|------------------|--------------------|---------------------------------------------|
| `power`          | `number`           | 电量，范围通常为 `0` 到 `100`                        |
| `version`        | `number`           | 设备版本                                        |
| `label`          | `number`           | 设备标签                                        |
| `intensityA`     | `number`           | A 通道当前强度                                    |
| `intensityB`     | `number`           | B 通道当前强度                                    |
| `connectState`   | `string`           | 连接状态，例如 `'connected'` / `'disconnected'`    |
| `channelAStatus` | `boolean`          | A 通道是否有插入配件                                 |
| `channelBStatus` | `boolean`          | B 通道是否有插入配件                                 |
| `mode`           | `0 \| 1 \| 2 \| 3` | 设备模式：`0` 关闭所有上报，`1` OMS，`2` HID，`3` iOS 翻页器 |
| `updateTime`     | `string`           | 设备上报更新时间，当前可能保留为空字符串                        |
| `updateValue`    | `string`           | 设备上报更新值，当前可能保留为空字符串                         |

### OVC V1 `slotState`

适用设备类型：`OVC_1`。

| 字段                 | 类型        | 说明        |
|--------------------|-----------|-----------|
| `channelA.isMuted` | `boolean` | A 通道是否静音  |
| `channelB.isMuted` | `boolean` | B 通道是否静音  |

### BMTR V1 `props`

适用设备类型：`BMTR_1`。

| 字段             | 类型       | 说明                                       |
|----------------|----------|------------------------------------------|
| `power`        | `number` | 电量，范围通常为 `0` 到 `100`                     |
| `version`      | `number` | 设备版本                                     |
| `label`        | `number` | 设备标签                                     |
| `pressure`     | `number` | 当前压力值                                    |
| `connectState` | `string` | 连接状态，例如 `'connected'` / `'disconnected'` |
| `updateTime`   | `string` | 设备上报更新时间，当前可能保留为空字符串                     |
| `updateValue`  | `string` | 设备上报更新值，当前可能保留为空字符串                      |

### BMTR V1 `slotState`

适用设备类型：`BMTR_1`。

| 字段               | 类型                      | 说明                                                             |
|------------------|-------------------------|----------------------------------------------------------------|
| `edge.edgeState` | `0 \| 1 \| 2 \| 3 \| 4` | 边控状态：`0` 停止，`1` 刺激状态，`2` 强制冷静最小时间计时，`3` 强制冷静并判断气压低于蓝线，`4` 允许高潮 |

</details>

## 常见问题

### APP 一直没有接入

检查 APP 使用的 WebSocket 地址是否能访问，并确认二维码或配对 URL 中的 `targetId` / `tid` 是当前控制方 `connect()` 返回的 `targetId`。控制方连接后 5 分钟内没有任何 APP 接入时，V4 服务器会发送 `idle_timeout` 并关闭连接；所有 APP 断开后也会重新开始空闲计时。

### 能收到 APP 接入，但控制不了设备

V4 操作需要同时指定 APP 的 `clientId` 和设备的 `slotId`。`clientId` 标识哪个 APP，`slotId` 标识这个 APP 内的哪个设备插槽。不要把两者混用。

### `device.op` 为什么没有立刻返回

`device.op` 是任务式 RPC。APP 被控方会等任务完成、被清理、被替换或连接断开取消后才返回响应。长时间任务可以设置 `timeout`，或使用 `clearOperate()` 主动清理。

### HTTP 下发返回 401

确认请求头 `apikey` 或 `x-apikey` 使用的是控制方 `connect()` 返回的 `secret`，不是 APP 的 `clientId`，也不是 `targetId`。

### HTTP 下发收不到 APP 的主动事件

HTTP 接口只用于下发 RPC 请求并等待对应响应，不支持订阅 `devices.snapshot`、`slots.patch`、`custom.action` 等 APP 主动上报事件。需要实时接收事件时，请使用 WebSocket 连接或 SDK 事件。
