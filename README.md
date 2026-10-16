<div align="center">

<img src="dglab.webp" alt="DG-LAB Logo" width="128" />

# DGLAB KIT

English | [简体中文](README_CN.md)

</div>

DGLAB KIT is a TypeScript SDK for the **DG-LAB 4 App**. It pairs with the app over WebSocket and controls the local devices exposed by the app from Bun, Node.js, browsers, and other JavaScript runtimes.

The SDK provides two main components:

- **Socket SDK**: Connect to V3 / V4 WebSocket relay servers for app pairing, device discovery, Channel Intensity control, Pulse delivery, task cleanup, and custom feedback.
- **Pulse SDK**: Built-in Coyote and Opossum Pulse data, ready to use with V3 / V4 Pulse operations.

> Use V4 for new integrations. V4 supports one controller connected to multiple app clients, with device lists, incremental device state updates, and RPC responses. V3 is provided for compatibility with legacy controllers.

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Quick Start: Control the App with V4](#quick-start-control-the-app-with-v4)
- [Generate an App Pairing QR Code](#generate-an-app-pairing-qr-code)
- [Socket SDK API](#socket-sdk-api)
- [Common V4 Operations](#common-v4-operations)
- [Manual Transport Mode](#manual-transport-mode)
- [Legacy V3 Protocol](#legacy-v3-protocol)
- [Pulse SDK](#pulse-sdk)
- [V4 Protocol Reference](#v4-protocol-reference)
- [Troubleshooting](#troubleshooting)

## Requirements

- Node.js 22+
- For TypeScript projects, use ES modules or an environment that supports top-level `await`. In CommonJS projects, wrap the examples in an `async function main()`.
- For browsers, React Native, mini programs, or other environments that need a custom WebSocket implementation, use [Manual Transport Mode](#manual-transport-mode).

## Installation

Install the SDK in your project:

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

## Core Concepts

| Term | Description |
|------|-------------|
| Controller | The application running `DglabSocket`, such as a web page, Node.js service, or mobile controller. |
| App client | The DG-LAB 4 App being controlled. |
| `targetId` | The pairing ID assigned when the controller connects. The app uses this ID to attach to the controller. |
| `clientId` | The connection ID of a specific V4 app client. Required when sending commands to that app. |
| `slotId` | The ID of a device exposed by the app. All device operations use `slotId` to identify the device. |
| `channel` | The device channel. V4 uses `V4Channel.A` / `V4Channel.B`, with protocol values `0` / `1`. |

V4 connections follow this topology:

```text
App 1 ──┐
App 2 ──┼──── ws ──── server_v4.js ◄──── ws ──── Controller (DglabSocket)
App 3 ──┘
```

The controller connects to the relay server, and the app attaches using the controller's `targetId`. Once attached, the app sends an initial `devices.snapshot`, followed by incremental updates through `devices.patch` and `slots.patch`.

## Quick Start: Control the App with V4

This example connects to a V4 relay server, obtains a pairing ID, waits for an app to attach, discovers devices, adjusts Channel Intensity on channel A, sends a built-in Pulse, and clears tasks.

```ts
import {
  COYOTE_WAVEFORM,
  COYOTE_WAVEFORMS,
  DglabSocket,
  V4Channel,
} from 'dglab-kit';

const socket = new DglabSocket({ url: 'wss://trex.dungeon-lab.cn/v4' });

socket.on('state', (state, previous) => {
  console.log('socket state:', previous, '->', state);
});

socket.on('devices', (devices, clientId) => {
  console.log('Device list updated:', clientId, devices);
});

socket.on('device', (device, clientId) => {
  console.log('Device changed:', clientId, device);
});

socket.on('action', (action) => {
  console.log('Custom app action:', action);
});

const { targetId } = await socket.connect();

console.log('Connect with the DG-LAB 4 App:', `wss://trex.dungeon-lab.cn/v4/?tid=${targetId}`);

socket.on('client-attached', async (clientId) => {
  console.log('App attached:', clientId);

  const { devices } = await socket.requestDevices(clientId);
  const slotId = devices[0]?.slotId;
  if (!slotId) {
    console.log('The app is not exposing any devices');
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

## Generate an App Pairing QR Code

V4 supports arbitrary URL paths. Typically, you place the controller's `targetId` in the query string, then generate a QR code for the app to scan or a link that opens the DG-LAB 4 App from a browser.

The V4 query parameter is `tid`, not `targetId`.

```ts
const appSocketUrl = `wss://trex.dungeon-lab.cn/v4/?tid=${targetId}`;

const qrcode = `https://dungeon-lab.cn/s/?v=1&action=socket&url=${encodeURIComponent(appSocketUrl)}`;
```

For a self-hosted server, replace `wss://trex.dungeon-lab.cn/v4` with your own V4 WebSocket URL.

## Socket SDK API

### Constructor

```ts
import { DglabSocket } from 'dglab-kit';

const socket = new DglabSocket(options);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | None | WebSocket server URL. Omit to use manual transport mode. |
| `protocols` | `string \| string[]` | None | WebSocket subprotocols. |
| `connectTimeout` | `number` | `8000` | Connection timeout in milliseconds. |
| `responseTimeout` | `number` | `8000` | Default V4 RPC response timeout in milliseconds. |
| `version` | `DGLAB_SOCKET_VERSION` | `DGLAB_SOCKET_VERSION.V4` | Protocol version. |

### `connect()` Result

```ts
const { targetId } = await socket.connect();
```

| Field | Description |
|-------|-------------|
| `targetId` | The current controller ID. App clients use it to attach. |

### Socket States

```ts
import type { DGLAB_SOCKET_STATE } from 'dglab-kit';
```

| State | Description |
|-------|-------------|
| `DGLAB_SOCKET_STATE.Idle` | Not connected. |
| `DGLAB_SOCKET_STATE.Connecting` | Establishing the WebSocket connection. |
| `DGLAB_SOCKET_STATE.WaitingForPeer` | Connected and waiting for an app to attach. |
| `DGLAB_SOCKET_STATE.Paired` | Paired and ready to send control commands. |
| `DGLAB_SOCKET_STATE.Disconnected` | Disconnected. |

### Common Events

| Event | Callback | Description |
|-------|----------|-------------|
| `state` | `(state, previous) => void` | Socket state changed. |
| `open` | `(event) => void` | WebSocket opened. |
| `close` | `(event) => void` | WebSocket closed. |
| `error` | `(error) => void` | Connection or protocol error. |
| `message` | `(data, raw) => void` | Raw message text received. |
| `frame` | `(frame) => void` | Parsed protocol frame received. |
| `data` | `(data, clientId?) => void` | Data received from the app. |
| `action` | `(action) => void` | Custom app action, from `custom.action` in V4 or `feedback-*` in V3. |
| `device` | `(device, clientId) => void` | Individual device event: full data for additions, incremental data for updates. |
| `devices` | `(devices, clientId) => void` | The current complete V4 device list changed. |
| `client-attached` | `(clientId) => void` | An app client attached. |
| `client-disconnected` | `(clientId) => void` | An app client disconnected. |

### V4 Properties and Methods

V4 supports multiple app clients, so every method targeting an app requires that app's `clientId`.

| API | Description |
|-----|-------------|
| `targetId` | Current controller ID, available after connecting. |
| `clientIds` | IDs of attached app clients. |
| `clients` | State objects for attached app clients. |
| `getClient(clientId)` | Get the state of a specific app client. |
| `ping(clientId, options?)` | Request an app response; returns the app's local timestamp when it received the request. |
| `requestDevices(clientId)` | Request the app's current device list. |
| `send(clientId, data, options?)` | Send a custom V4 RPC and wait for its response. |
| `resetIntensity(clientId, slotId, channel, options?)` | Set Channel Intensity to `0`. |
| `addIntensity(clientId, slotId, channel, value, options?)` | Increase Channel Intensity. |
| `reduceStrength(clientId, slotId, channel, value, options?)` | Decrease Channel Intensity. |
| `setTempIntensity(clientId, slotId, channel, value, duration, options?)` | Apply a Temporary Intensity Change; the temporary value resets to `0` when the task ends. |
| `sendPulse(clientId, slotId, channel, duration, frames, options?)` | Send Pulse frames. |
| `clearPulse(clientId, slotId, channel)` | Clear all tasks on the specified device channel. Equivalent to calling `clearOperate` for that channel. |
| `clearOperate(clientId, options?)` | Clear all tasks, or tasks for a specific device or channel. |

### V4 Operation Options

The `options` argument for `resetIntensity()`, `addIntensity()`, `reduceStrength()`, `setTempIntensity()`, and `sendPulse()` supports the following fields:

| Option | Description |
|--------|-------------|
| `timeout` | Response timeout for this command, in milliseconds. |
| `priority` | Task priority: `0 \| 1 \| 2`. The default is determined by the protocol implementation. |
| `immediate` | Whether to replace existing tasks with the same device, channel, and task type. |

`sendPulse()` also supports `version` and `seq`. The `options` argument for `send()` and `ping()` supports only `timeout`. For `clearOperate()`, `options` specifies `slotId` and `channel`; the operation options above do not apply.

## Common V4 Operations

### Request the Device List

```ts
const { devices } = await socket.requestDevices(clientId);

for (const device of devices) {
  console.log(device.slotId, device.name, device.type);
}
```

Once a device appears in `devices.snapshot`, `devices.get`, or `devices.patch.added`, you can operate it directly. No additional connection command is needed for the slot.

### Measure App Round-Trip Latency

```ts
const startedAt = performance.now();
const receivedAt = await socket.ping(clientId);
const rtt = performance.now() - startedAt;

console.log('RTT:', rtt, 'ms');
console.log('App local timestamp when ping was received:', receivedAt);
```

`ping()` returns the app's local timestamp when it received the request. Calculate round-trip time on the controller by measuring the elapsed time, as shown above.

### Channel Intensity Control

```ts
await socket.resetIntensity(clientId, slotId, V4Channel.A);
await socket.addIntensity(clientId, slotId, V4Channel.A, 5);
await socket.reduceStrength(clientId, slotId, V4Channel.B, 3);
```

### Temporary Intensity Change

```ts
await socket.setTempIntensity(
  clientId,
  slotId,
  V4Channel.A,
  30,   // Temporary intensity
  3000, // Duration in milliseconds
);
```

### Send a Pulse

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

### Clear Tasks

```ts
// Clear all tasks for an app client
await socket.clearOperate(clientId);

// Clear tasks on all channels of a specific device
await socket.clearOperate(clientId, { slotId });

// Clear tasks on a specific device channel
await socket.clearOperate(clientId, { slotId, channel: V4Channel.A });
```

### Send a Custom RPC

Use `send()` for V4 RPCs without a dedicated SDK method. It adds a `reqId` and waits for a response with the same `reqId`. This example sends `devices.get` directly; for typical use, prefer the equivalent `requestDevices()` method:

```ts
const result = await socket.send(clientId, {
  t: 'req',
  m: 'devices.get',
});

console.log(result);
```

## Manual Transport Mode

When `url` is omitted, the SDK does not create a WebSocket connection. Bind your own transport and forward its WebSocket lifecycle events to the SDK.

```ts
import { DglabSocket } from 'dglab-kit';

const socket = new DglabSocket();
const ws = new WebSocket('wss://trex.dungeon-lab.cn/v4');

socket.setSender((data) => ws.send(data));

ws.addEventListener('open', (event) => socket.handleOpen(event));
ws.addEventListener('message', (event) => socket.handleMessage(event.data));
ws.addEventListener('close', (event) => socket.handleClose(event));
ws.addEventListener('error', (event) => socket.handleError(event));

const { targetId } = await socket.connect();
console.log(targetId);
```

Use manual transport mode in browsers, React Native, mini programs, or any runtime that needs a custom WebSocket implementation.

## Legacy V3 Protocol

Enable V3 explicitly with `DGLAB_SOCKET_VERSION.V3`. V3 maintains a single app pairing and is intended for compatibility with legacy controllers.

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
console.log('Connect with the app:', `wss://ws.dungeon-lab.cn/${targetId}`);

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
  console.log('App button feedback:', action);
});
```

### V3 Methods

| API | Description |
|-----|-------------|
| `targetId` | Current controller ID, available after connecting. |
| `pairedClientId` | ID of the paired app client. |
| `send(data)` | Send custom data using the legacy protocol. |
| `addStrength(channel, step?)` | Increase Channel Intensity. |
| `reduceStrength(channel, step?)` | Decrease Channel Intensity. |
| `setStrength(channel, strength)` | Set Channel Intensity. |
| `sendPulse(options)` | Send a Pulse. |
| `clearPulse(channel)` | Clear Pulses on the channel. |

For V3 intensity and clear methods, use `V3Channel.A` or `V3Channel.B` for `channel`.

V3 `sendPulse` accepts `{ channel, time, data }`:

| Field | Description |
|-------|-------------|
| `channel` | Pulse channel: `'A'` or `'B'`. |
| `time` | Duration in seconds. |
| `data` | Pulse frames as a JSON string or a list of hexadecimal frames. |

## Pulse SDK

The built-in Pulse library includes Coyote and Opossum data.

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

Each Pulse entry has the following structure:

```ts
{
  label: {
    cn: string;
    en: string;
  };
  raw: string[];
}
```

`raw` is a list of hexadecimal Pulse frames. Pass it directly as `data` in V3 `sendPulse({ data })`, or as `frames` in V4 `sendPulse(clientId, ..., frames, ...)`.

```ts
const frames = COYOTE_WAVEFORMS[COYOTE_WAVEFORM.BUBBLE].raw;

socketV3.sendPulse({
  channel: 'A',
  time: 5,
  data: frames,
});

await socketV4.sendPulse(clientId, slotId, V4Channel.A, 1000, frames);
```

## V4 Protocol Reference

This section covers debugging, implementations in other languages, and direct integration with the V4 WebSocket protocol. If you use the `DglabSocket` methods, start with the quick start and API sections above.

<details>
<summary>V4 connection flow, server frames, heartbeats, and close codes</summary>

### Controller Connection

The controller connects directly to the server:

```text
wss://trex.dungeon-lab.cn/v4
```

Once connected, the server returns:

```json
{ "type": "hello", "clientId": "controller-client-id" }
```

The controller stores this `clientId`. App clients use it as their `targetId` when attaching.

When an app client attaches, the controller receives:

```json
{ "type": "client_attached", "clientId": "controlled-client-id" }
```

When an app client disconnects, the controller receives:

```json
{ "type": "client_disconnected", "clientId": "controlled-client-id" }
```

The controller should maintain a list of app clients keyed by their `clientId`. All subsequent application messages sent to a specific app must include its `clientId` in the outer server frame.

### App Client Connection

An app client connects using the controller's `clientId`:

```text
wss://trex.dungeon-lab.cn/v4?tid=<controller-client-id>
```

Once connected, the server sends the app client:

```json
{ "type": "hello", "clientId": "controlled-client-id" }
{ "type": "controller_attached", "clientId": "controller-client-id" }
```

After receiving `controller_attached`, the app client should immediately send all current device information in a `devices.snapshot` event. When the controller disconnects, the app client receives:

```json
{ "type": "controller_disconnected", "clientId": "controller-client-id" }
```

The server then closes the app client's connection.

### Common Server Frames

| `type` | Direction | Description |
|--------|-----------|-------------|
| `hello` | Server → client | Assigns a `clientId` to the current connection. |
| `client_attached` | Server → controller | An app client attached. |
| `client_disconnected` | Server → controller | An app client disconnected. |
| `controller_attached` | Server → app client | The app attached to a controller. |
| `controller_disconnected` | Server → app client | The controller disconnected; the app connection will close next. |
| `heartbeat` | Server → client | Server heartbeat, typically every 30 seconds. |
| `ping` | Client → server | Server-level connection probe; not forwarded to the peer. |
| `pong` | Server → client | Response to `ping`; may include a `ts` timestamp. |
| `message` | Controller ↔ app client | Relays an application message. |
| `idle_timeout` | Server → controller | The controller's idle timeout expired; the connection will close next. |
| `error` | Server → client | Server error, such as `controller_not_found`. |

### Idle Timeout

If no app client attaches within five minutes of the controller connecting, the server sends:

```json
{ "type": "idle_timeout" }
```

The server then closes the controller's connection. This five-minute idle timer also restarts when all app clients have disconnected.

### Heartbeats and Server-Level Ping

The server sends the following every 30 seconds:

```json
{ "type": "heartbeat" }
```

Clients do not need to reply. A client can also send a server-level ping:

```json
{ "type": "ping" }
```

The server responds with:

```json
{ "type": "pong", "ts": 1710000000123 }
```

This probes the connection between the client and the V4 Socket server. It is not forwarded to the peer.

### WebSocket Close Codes

| Close Code | Reason | Recipient | Description |
|------------|--------|-----------|-------------|
| `4000` | `controller_disconnected` | App client | The controller disconnected, so the app client is disconnected as well. |
| `4001` | `controller_not_found` | App client | No controller exists for the specified `targetId`. |
| `4002` | `idle_timeout` | Controller | The controller's idle timeout expired. |

Normal connection closures do not use the application-specific codes in the 4000+ range.

</details>

<details>
<summary>V4 message envelopes and app messages</summary>

### Send to a Specific App

When the controller sends an application message, the outer server frame has this structure:

```json
{
  "type": "message",
  "clientId": "controlled-client-id",
  "data": {}
}
```

| Field | Description |
|-------|-------------|
| `type` | Always `'message'`. |
| `clientId` | The target app client's `clientId`. |
| `data` | The application message; see the `t` field below. |

### Receive App Messages

The server adds the source `clientId` to application messages sent by an app client:

```json
{
  "type": "message",
  "clientId": "controlled-client-id",
  "data": {}
}
```

The controller uses the outer `clientId` to identify the sending app.

### App Message Types

App messages are carried in the outer `message.data` field. Each includes a `t` field:

| `t` | Description |
|-----|-------------|
| `req` | RPC request from the controller to an app client. |
| `resp` | RPC response from an app client. |
| `ev` | Event sent by an app client. |

RPC request fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `t` | `'req'` | Yes | Identifies an RPC request. |
| `reqId` | `string` | Yes | Request ID used to match the response. Must be unique among pending requests for the same app client. |
| `m` | `string` | Yes | RPC method name. |
| `data` | `object` | No | Method-specific RPC parameters. |

RPC response fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `t` | `'resp'` | Yes | Identifies an RPC response. |
| `reqId` | `string` | Yes | The corresponding request's `reqId`. |
| `result` | `unknown` | No | Successful result; mutually exclusive with `error`. |
| `error` | `string` | No | Error code or reason; mutually exclusive with `result`. |

Common RPC methods:

| Method | `data` Type | `result` Type | Description |
|--------|-------------|---------------|-------------|
| `devices.get` | None | `{ devices: RemoteDevice[] }` | Get the devices currently exposed by the app client. |
| `ping` | None | `number` | Probe the controller-to-app connection; returns the app's local timestamp when it received the ping. |
| `device.op` | `DeviceOperate` | `DeviceOperateResult` | Submit a device operation task. |
| `device.op.clear` | `ClearOperate` | `{}` | Clear all tasks, or tasks for a specific device or channel. |

</details>

<details>
<summary>V4 device model and events</summary>

### Device Descriptors

`devices.get`, `devices.snapshot`, and `devices.patch` use the following device descriptor:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `number` | No | Device index, included in some responses. |
| `slotId` | `string` | Yes | The device's actual ID, used to identify it in device operations. |
| `name` | `string` | Yes | Device display name. |
| `type` | `string` | Yes | Device type, such as `COYOTE_030`. |
| `props` | `object` | No | Current device property snapshot, included in full device information. |
| `slotState` | `object` | No | Current device state snapshot, included in full device information. |

In `devices.snapshot.devices[]` and `devices.patch.added[]`, `props` and `slotState` are complete current snapshots. In `slots.patch.slots[]`, they contain only the fields that changed during the current tick. Controllers should deep-merge these updates into their local cache by `slotId`.

### `devices.snapshot`

An app client sends all current devices immediately after attaching. If no devices are available, `devices` is still sent as an empty array.

```json
{
  "t": "ev",
  "ev": "devices.snapshot",
  "devices": [
    {
      "id": 0,
      "slotId": "slot-a",
      "name": "Device A",
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

The controller should replace its local device list for that app with `devices`.

### `devices.patch`

An app client sends incremental updates when its device list changes.

```json
{
  "t": "ev",
  "ev": "devices.patch",
  "added": [
    {
      "id": 2,
      "slotId": "slot-c",
      "name": "Device C",
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

| Field | Description |
|-------|-------------|
| `added` | Full information for added devices, including `props` and `slotState`. |
| `removed` | String `slotId` values of removed devices. |

The controller should update its local device list directly from `devices.patch`. It does not need to request the full list again.

### `slots.patch`

An app client batches device state changes by tick and sends them as updates.

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

The controller updates the matching device state using the string `slotId`.

### `custom.action`

An app client can send custom actions from `0` to `9` to the controller.

```json
{ "t": "ev", "ev": "custom.action", "action": 7 }
```

The controller should validate that `action` is an integer from `0` to `9`.

</details>

<details>
<summary>V4 device operation RPCs</summary>

Device operations are submitted through `device.op`. The controller does not supply an internal task ID; the app client uses the outer RPC `reqId` as the task ID.

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

### Common `DeviceOperate` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `s` | `string` | Yes | The device's string `slotId`. |
| `t` | `number` | Yes | `ActionType`; see below. |
| `c` | `0 \| 1` | Yes | Channel: `0` = A, `1` = B. |
| `p` | `0 \| 1 \| 2` | No | Priority. Defaults to `1`. |
| `d` | `number` | No | Duration in milliseconds. Defaults to `0`. |
| `im` | `boolean` | No | Whether to replace existing tasks with the same device, channel, and task type. |

### Scheduling Rules

- Different devices, channels, task types, and priorities are scheduled independently.
- Tasks with the same device, channel, task type, and priority execute in queue order.
- Consecutive `oneShot` tasks queued within the same tick all execute during that tick.
- `im: true` first replaces existing tasks with the same device, channel, and task type.
- For continuous tasks, `d: 0` disables automatic completion based on duration. `AppendPulseData` still completes once all frames have been consumed.

### Supported `ActionType` Values

| `t` | Operation Type | Additional Fields | Lifecycle | SDK Method |
|-----|----------------|-------------------|-----------|------------|
| `0` | `AppendPulseData` | `v`, `ver?`, `seq?` | Continuous | `sendPulse` |
| `3` | `AddIntensity` | `v` | `oneShot` | `addIntensity` / `reduceStrength` |
| `4` | `SetTempIntensity` | `v` | Continuous | `setTempIntensity` |
| `7` | `SetIntensity` | `v` | `oneShot` | `resetIntensity` |

The public `V4ActionType` enum currently contains only these four operations. Use `device.op.clear` to clear Pulses or tasks.

### `AppendPulseData` (`t: 0`)

Push Pulse data to the specified channel. One frame from `v` is consumed per tick, typically at 100 ms intervals.

| Field | Type | Description |
|-------|------|-------------|
| `d` | `number` | Maximum playback duration in milliseconds. |
| `v` | `number[][] \| string[]` | Raw Pulse frames. Strings use hexadecimal byte notation. |
| `ver` | `number` | Optional. `2` selects V2 Pulse frames; omit or use `3` for V3 frames. |
| `seq` | `number` | Optional frame sequence number for legacy protocol compatibility. |

Pulse frame formats:

| `ver` | Frame Format |
|-------|--------------|
| `2` | `[a, b, interval]` |
| `3` | `[a1, a2, a3, a4, b1, b2, b3, b4]` |

Hexadecimal strings must contain complete byte pairs, such as `0A0A0A0A00000000`. The SDK's built-in Pulses provide valid hexadecimal frame lists directly.

### `AddIntensity` (`t: 3`)

Adjust Channel Intensity by a relative amount. `v` can be positive or negative.

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

Apply a Temporary Intensity Change to the specified channel. When the task ends, the app client automatically resets the temporary intensity to `0`.

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

### `SetIntensity` (`t: 7`)

Set the absolute Channel Intensity to `0`. V4 does not accept any other target value for this operation.

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

### `device.op` Responses

`device.op` does not respond as soon as a task is queued. The app client returns the RPC response only when the task completes, is cleared or replaced, or is cancelled on disconnection.

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

| Field | Type | Description |
|-------|------|-------------|
| `type` | `ActionType` | Type of the task that ended. |
| `reason` | `'completed' \| 'cleared' \| 'replaced' \| 'cancelled'` | Reason the task ended. |
| `slotId` | `string` | The task's device `slotId`; may be omitted. |
| `channel` | `0 \| 1` | The task's channel; may be omitted. |

Common RPC errors:

| `error` | Condition |
|---------|-----------|
| `duplicate_request_id` | A pending `device.op` for the same app client already uses this `reqId`. |
| `invalid_params` | `data` is not an object, or `device.op.clear` parameters are invalid. |
| `slot_not_found` | `s` is missing or the specified device does not exist. |
| `invalid_operate` | Task fields do not match the schema, or the task type is unsupported. |
| `method_not_found` | The RPC method is not supported by the current implementation. |
| `internal_error` | The app client encountered an unexpected exception while handling the request. |

### `device.op.clear`

Clear all tasks for all devices:

```json
{ "t": "req", "reqId": "req-3", "m": "device.op.clear" }
```

Clear tasks on all channels of one device:

```json
{ "t": "req", "reqId": "req-4", "m": "device.op.clear", "data": { "s": "slot-a" } }
```

Clear tasks on a specific channel of one device:

```json
{ "t": "req", "reqId": "req-5", "m": "device.op.clear", "data": { "s": "slot-a", "c": 0 } }
```

On success, `device.op.clear` returns an empty object `{}`. Each cleared queued task with an RPC `reqId` also receives its own `device.op` response with `reason: 'cleared'`. `data.c` requires `data.s`; passing only `{ "c": 0 }` returns `invalid_params`.

</details>

<details>
<summary>V4 device props / slotState field reference</summary>

### Common `slotState`

All devices provide these state fields:

| Field | Type | Description |
|-------|------|-------------|
| `markLight` | `'yellow' \| 'green' \| 'red' \| 'purple' \| 'blue' \| 'cyan' \| null` | Device light color; typically falls back to `'yellow'` when unset. |
| `hasDevice` | `boolean` | Whether the device is currently connected over Bluetooth. |

### Coyote V2 / Coyote V3 `props` | Coyote stimulator

Applies to device types `COYOTE_020` and `COYOTE_030`.

| Field | Type | Description |
|-------|------|-------------|
| `power` | `number` | Battery level, typically `0` to `100`. |
| `version` | `number` | Device version. |
| `label` | `number` | Device label. |
| `intensityA` | `number` | Current Channel Intensity on channel A. |
| `intensityB` | `number` | Current Channel Intensity on channel B. |
| `connectState` | `string` | Connection state, such as `'connected'` / `'disconnected'`. |

`COYOTE_030` also provides:

| Field | Type | Description |
|-------|------|-------------|
| `channelAStatus` | `0 \| 1 \| 2 \| 3 \| 4` | Channel A output status: `0` no output or output too low to detect; `1` open circuit; `2` normal output; `3` output fault; `4` channel output blocked. |
| `channelBStatus` | `0 \| 1 \| 2 \| 3 \| 4` | Channel B output status; uses the same values as `channelAStatus`. |
| `updateValue` | `string` | Update value reported by the device. |

#### Coyote V2 / Coyote V3 `slotState`

Applies to device types `COYOTE_020` and `COYOTE_030`. `channelA` and `channelB` have the same structure:

| Field | Type | Description |
|-------|------|-------------|
| `channelA.isMuted` / `channelB.isMuted` | `boolean` | Whether the channel is muted. |
| `channelA.warmUpScale` / `channelB.warmUpScale` | `number` | Cold-start scale factor, typically `0` to `1`. |
| `channelA.intensityMax` / `channelB.intensityMax` | `number` | Current maximum Channel Intensity, calculated from `comfortLimit` parameters. |
| `channelA.comfortLimit.mode` / `channelB.comfortLimit.mode` | `'simple' \| 'complex'` | Comfort Limit mode. |
| `channelA.comfortLimit.comfortMax` / `channelB.comfortLimit.comfortMax` | `number` | Comfort Limit. |
| `channelA.comfortLimit.absoluteMax` / `channelB.comfortLimit.absoluteMax` | `number` | Absolute Limit. |
| `channelA.comfortLimit.overheat` / `channelB.comfortLimit.overheat` | `boolean` | Whether the channel is in an overheated state. |
| `channelA.comfortLimit.overheatPercent` / `channelB.comfortLimit.overheatPercent` | `number` | Intensity percentage used during overheating. |
| `channelA.comfortLimit.autoIncr` / `channelB.comfortLimit.autoIncr` | `boolean` | Whether Adaptive Limit Adjustment is enabled. |
| `channelA.comfortLimit.autoIncrMax` / `channelB.comfortLimit.autoIncrMax` | `number` | Maximum adaptive increase. |
| `channelA.comfortLimit.autoIncrScope` / `channelB.comfortLimit.autoIncrScope` | `1 \| 2 \| 3` | Adaptive adjustment scope: `1` Comfort Limit only; `2` Absolute Limit only; `3` both limits. |
| `channelA.comfortLimit.totalIncr` / `channelB.comfortLimit.totalIncr` | `number` | Current cumulative adaptive increase. |

### OVC V1 `props` | Opossum vibration controller

Applies to device type `OVC_1`.

| Field | Type | Description |
|-------|------|-------------|
| `power` | `number` | Battery level, typically `0` to `100`. |
| `version` | `number` | Device version. |
| `label` | `number` | Device label. |
| `intensityA` | `number` | Current Channel Intensity on channel A. |
| `intensityB` | `number` | Current Channel Intensity on channel B. |
| `connectState` | `string` | Connection state, such as `'connected'` / `'disconnected'`. |
| `channelAStatus` | `boolean` | Whether an accessory is plugged into channel A. |
| `channelBStatus` | `boolean` | Whether an accessory is plugged into channel B. |
| `mode` | `0 \| 1 \| 2 \| 3` | Device mode: `0` disables all reporting; `1` OMS; `2` HID; `3` iOS page turner. |
| `updateTime` | `string` | Update timestamp reported by the device; may currently remain an empty string. |
| `updateValue` | `string` | Update value reported by the device; may currently remain an empty string. |

#### OVC V1 `slotState`

Applies to device type `OVC_1`.

| Field | Type | Description |
|-------|------|-------------|
| `channelA.isMuted` | `boolean` | Whether channel A is muted. |
| `channelB.isMuted` | `boolean` | Whether channel B is muted. |

### BMTR V1 `props` | Civet edging sensor

Applies to device type `BMTR_1`.

| Field | Type | Description |
|-------|------|-------------|
| `power` | `number` | Battery level, typically `0` to `100`. |
| `version` | `number` | Device version. |
| `label` | `number` | Device label. |
| `pressure` | `number` | Current pressure reading. |
| `connectState` | `string` | Connection state, such as `'connected'` / `'disconnected'`. |
| `updateTime` | `string` | Update timestamp reported by the device; may currently remain an empty string. |
| `updateValue` | `string` | Update value reported by the device; may currently remain an empty string. |

#### BMTR V1 `slotState`

Applies to device type `BMTR_1`.

| Field | Type | Description |
|-------|------|-------------|
| `edge.edgeState` | `0 \| 1 \| 2 \| 3 \| 4` | Edging state: `0` stopped; `1` Stimulation Phase; `2` minimum Cooldown Phase timer running; `3` Cooldown Phase, checking whether pressure is below the blue line; `4` climax allowed. |

</details>

## Troubleshooting

### The App Does Not Attach

Check that the app can reach the WebSocket URL and that the `targetId` / `tid` in the QR code or pairing URL matches the `targetId` returned by the controller's current `connect()` call. If no app attaches within five minutes, the V4 server sends `idle_timeout` and closes the controller's connection. The idle timer also restarts when all apps disconnect.

### The App Attaches, but Device Control Does Not Work

V4 operations require both the app's `clientId` and the device's `slotId`. `clientId` identifies the app, while `slotId` identifies a device within that app. Use each ID in its corresponding argument.

### `device.op` Does Not Respond Immediately

`device.op` is a task-based RPC. The app client responds when the task completes, is cleared or replaced, or is cancelled on disconnection. For long-running tasks, set an appropriate `timeout` or clear them explicitly with `clearOperate()`.
