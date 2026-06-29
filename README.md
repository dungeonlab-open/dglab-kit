# DGLAB KIT

## 安装

```bash
bun install
```

在项目中使用包导出：

```ts
import { DglabSocket } from 'dglab-kit';
```

## 构建与测试

```bash
bun run build
bun run test:types
bun run lint
```

## Socket SDK

### 基础连接

```ts
import { DGLAB_SOCKET_STATE, DglabSocket } from 'dglab-kit';

const socket = new DglabSocket({
  url: 'ws://127.0.0.1:9998',
  connectTimeout: 8000,
  responseTimeout: 8000,
});

socket.on('state', (state, previous) => {
  console.log('socket state:', previous, '->', state);
});

socket.on('error', (error) => {
  console.error('socket error:', error);
});

const { targetId, secret } = await socket.connect();

console.log('控制方 ID:', targetId);
console.log('HTTP 鉴权密钥:', secret);
console.log(socket.state === DGLAB_SOCKET_STATE.WaitingForPeer);
```

`connect()` 返回的 `targetId` 是当前控制方 ID，需要展示给被控端或通过二维码传给被控端。V4 还会返回 `secret`，可用于服务端 HTTP 接口鉴权。

### 连接选项

| 选项                | 类型                     | 说明                                  |
|-------------------|------------------------|-------------------------------------|
| `url`             | `string`               | WebSocket 服务地址。省略时进入手动传输模式          |
| `protocols`       | `string \| string[]`   | WebSocket 子协议                       |
| `connectTimeout`  | `number`               | 等待连接完成的超时时间，单位 ms，默认 `8000`         |
| `responseTimeout` | `number`               | V4 等待 RPC 响应的默认超时时间，单位 ms，默认 `8000` |
| `version`         | `DGLAB_SOCKET_VERSION` | 协议版本，默认 `DGLAB_SOCKET_VERSION.V4`   |

### 状态

| 状态                                  | 说明          |
|-------------------------------------|-------------|
| `DGLAB_SOCKET_STATE.Idle`           | 未连接         |
| `DGLAB_SOCKET_STATE.Connecting`     | 正在连接        |
| `DGLAB_SOCKET_STATE.WaitingForPeer` | 已连接，等待被控端接入 |
| `DGLAB_SOCKET_STATE.Paired`         | 已配对，可下发控制指令 |
| `DGLAB_SOCKET_STATE.Disconnected`   | 已断开         |

### 通用事件

| 事件                    | 回调                            | 说明            |
|-----------------------|-------------------------------|---------------|
| `state`               | `(state, previous) => void`   | Socket 状态变化   |
| `open`                | `(event) => void`             | WebSocket 已打开 |
| `close`               | `(event) => void`             | WebSocket 已关闭 |
| `error`               | `(error) => void`             | 连接或协议错误       |
| `message`             | `(data, raw) => void`         | 收到原始消息文本      |
| `frame`               | `(frame) => void`             | 收到已解析协议帧      |
| `data`                | `(data, clientId?) => void`   | 收到被控端上行应用数据   |
| `action`              | `(action) => void`            | APP 自定义动作，V4 来自 `custom.action`，V3 来自 `feedback-*` |
| `device`              | `(device, clientId) => void`  | 单设备事件，新增为完整数据，更新为增量 |
| `devices`             | `(devices, clientId) => void` | V4 当前完整设备列表更新  |
| `client-attached`     | `(clientId) => void`          | 被控端接入         |
| `client-disconnected` | `(clientId) => void`          | 被控端断开         |

## V4 用法

V4 支持 `1 控制方 : N 被控方`。所有下发给被控端的指令都需要传入目标 `clientId`。

```ts
import {
  COYOTE_WAVEFORM,
  COYOTE_WAVEFORMS,
  DglabSocket,
  V4Channel,
} from 'dglab-kit';

const socket = new DglabSocket({ url: 'ws://127.0.0.1:9998' });
const { targetId } = await socket.connect();

console.log('将控制方 ID 交给被控端:', targetId);

socket.on('client-attached', async (clientId) => {
  console.log('被控端接入:', clientId);

  const { devices } = await socket.requestDevices(clientId);
  const slotId = devices[0]?.slotId;
  if (!slotId) return;

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

socket.on('devices', (devices, clientId) => {
  console.log('设备列表更新:', clientId, devices);
});

socket.on('device', (device, clientId) => {
  console.log('单设备变化:', clientId, device);
});

socket.on('action', (action) => {
  console.log('APP 自定义动作:', action);
});
```

### V4 属性与方法

| API                                                                     | 说明                   |
|-------------------------------------------------------------------------|----------------------|
| `targetId`                                                              | 当前控制方 ID，连接成功后可用     |
| `secret`                                                                | HTTP 鉴权密钥，连接成功后可用    |
| `clientIds`                                                             | 已接入被控端 ID 列表         |
| `clients`                                                               | 已接入被控端状态列表           |
| `getClient(clientId)`                                                   | 获取指定被控端状态            |
| `requestDevices(clientId)`                                              | 请求被控端最新设备列表          |
| `send(clientId, data, options)`                                         | 发送自定义 V4 RPC 或应用层数据  |
| `resetIntensity(clientId, slotId, channel, options)`                    | 设置通道强度为 0            |
| `addIntensity(clientId, slotId, channel, value, options)`               | 增加强度                 |
| `reduceStrength(clientId, slotId, channel, value, options)`             | 减少强度                 |
| `setTempIntensity(clientId, slotId, channel, value, duration, options)` | 设置临时强度               |
| `sendPulse(clientId, slotId, channel, duration, frames, options)`       | 下发波形帧                |
| `clearPulse(clientId, slotId, channel)`                                 | 清理指定设备通道波形           |
| `clearOperate(clientId, options?)`                                      | 清理任务，可清理全部、指定设备或指定通道 |

`channel` 使用 `V4Channel.A` 或 `V4Channel.B`。V4 的 `sendPulse` 中，`frames` 可直接使用内置波形的 `raw`：

```ts
await socket.sendPulse(
  clientId,
  slotId,
  V4Channel.A,
  1000,
  COYOTE_WAVEFORMS[COYOTE_WAVEFORM.BUBBLE].raw,
);
```

### V4 操作选项

| 选项          | 说明                    |
|-------------|-----------------------|
| `timeout`   | 本次指令等待响应的超时时间，单位 ms   |
| `priority`  | 任务优先级，`0 \| 1 \| 2`   |
| `immediate` | 是否替换同类任务              |

## V3 用法

V3 为旧协议，使用 `DGLAB_SOCKET_VERSION.V3` 显式开启。V3 只维护一个被控端配对关系。

```ts
import {
  COYOTE_WAVEFORM,
  COYOTE_WAVEFORMS,
  DGLAB_SOCKET_VERSION,
  DglabSocket,
} from 'dglab-kit';

const socket = new DglabSocket({
  version: DGLAB_SOCKET_VERSION.V3,
  url: 'wss://ws.dungeon-lab.cn/',
});

const { targetId } = await socket.connect();
console.log('将控制方 ID 交给被控端:', targetId);

socket.on('client-attached', () => {
  socket.setStrength(1, 20);
  socket.addStrength(1, 3);
  socket.reduceStrength(2, 1);

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

| API                              | 说明                         |
|----------------------------------|----------------------------|
| `targetId`                       | 当前控制方 ID，连接成功后可用           |
| `pairedClientId`                 | 已配对被控端 ID                  |
| `send(data)`                     | 发送旧协议自定义数据                 |
| `addStrength(channel, step?)`    | 增加强度，`channel` 为 `1` 或 `2` |
| `reduceStrength(channel, step?)` | 减少强度                       |
| `setStrength(channel, strength)` | 设置强度                       |
| `sendPulse(options)`             | 下发波形                       |
| `clearPulse(channel)`            | 清空通道波形                     |

V3 的 `sendPulse` 参数为 `{ channel, time, data }`：

| 字段        | 说明                   |
|-----------|----------------------|
| `channel` | 波形通道，`'A'` 或 `'B'`   |
| `time`    | 持续时间，单位秒             |
| `data`    | 波形帧 JSON 字符串或十六进制帧列表 |

V3 的 `data` 同样可直接使用内置波形的 `raw`：

```ts
socket.sendPulse({
  channel: 'A',
  time: 5,
  data: COYOTE_WAVEFORMS[COYOTE_WAVEFORM.BUBBLE].raw,
});
```

## 手动传输模式

不传 `url` 时，SDK 不会主动创建 WebSocket。你可以绑定自己的传输实现，并把 WebSocket 事件转交给 SDK。

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
