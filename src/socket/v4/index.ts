import { createNamedError } from '@/shared';
import {
  DGLAB_SOCKET_STATE,
  type DglabSocketConnectResult,
  type DglabSocketIncoming,
} from '@/socket';
import { DglabSocketBase } from '@/socket/base';
import { V4Client } from './client';
import { V4Rpc } from './rpc';
import type {
  V4AppendPulseDataOperate,
  V4AppendPulseDataOptions,
  V4Channel,
  V4ClearOperateOptions,
  V4DeviceOperate,
  V4DevicesGetResult,
  V4DeviceEventPayload,
  V4DeviceInfo,
  V4HelloFrame,
  V4MessageFrame,
  V4OperateOptions,
  V4RpcRequest,
  V4RpcResponse,
  V4SendOptions,
  V4SendPromise,
  V4ServerFrame,
} from './types';
import { V4ActionType as V4Action } from './types';

export class DglabSocketV4 extends DglabSocketBase {
  private _targetId?: string; // 被控端 ID
  private _secret?: string; // HTTP 密钥

  private readonly clientMap = new Map<string, V4Client>(); // 已接入被控方集合
  readonly rpc = new V4Rpc((frame) => this.sendFrame(frame), this.options);

  /**
   * 获取被控端 ID
   * @return string | undefined
   */
  get targetId(): string | undefined {
    return this._targetId;
  }

  /**
   * 获取 HTTP 密钥
   * @return string | undefined
   */
  get secret(): string | undefined {
    return this._secret;
  }

  /**
   * 获取已接入被控端 clientId 集合
   * @return string[]
   */
  get clientIds(): string[] {
    return [...this.clientMap.keys()];
  }

  /**
   * 获取已接入被控方列表
   * @return V4Client[]
   */
  get clients(): V4Client[] {
    return [...this.clientMap.values()];
  }

  /**
   * 获取指定被控方连接
   * @param clientId 被控方 ID
   * @return V4Client | undefined
   */
  getClient(clientId: string): V4Client | undefined {
    return this.clientMap.get(clientId);
  }

  /**
   * 请求最新设备列表
   * @param clientId 被控端 ID
   * @return Promise<V4DevicesGetResult>
   */
  async requestDevices(clientId: string): Promise<V4DevicesGetResult> {
    const request = this.rpc.createRequest('devices.get');
    const result = await this.rpc.send<V4RpcRequest, V4DevicesGetResult>(
      clientId,
      request,
    );

    const client = this.ensureClient(clientId);
    if (client.dispatch({ t: 'resp', result })) {
      this.dispatch('devices', client.devices, client.clientId);
    }

    return result;
  }

  /**
   * 发送协议数据
   * @param clientId 被控方 ID
   * @param data 数据
   * @param options 选项
   * @return V4SendPromise<TResponse>
   */
  send<TData = unknown, TResponse = unknown>(
    clientId: string,
    data: TData,
    options?: V4SendOptions,
  ): V4SendPromise<TResponse> {
    return this.rpc.send(clientId, data, options);
  }

  /**
   * 增加强度（相对）
   * @param clientId 被控方 ID
   * @param slotId 设备 ID
   * @param channel 通道
   * @param value 强度
   * @param options 选项
   * @return V4SendPromise<unknown>
   */
  addIntensity(
    clientId: string,
    slotId: string,
    channel: V4Channel,
    value: number,
    options?: V4OperateOptions,
  ): V4SendPromise {
    // 相对增减强度使用 device.op 的 AddIntensity 任务
    return this.rpc.sendOperate(
      clientId,
      {
        ...this.createOperateBase(slotId, channel, options),
        t: V4Action.AddIntensity,
        v: value,
      },
      options,
    );
  }

  /**
   * 减少强度（相对）
   * @param clientId 被控方 ID
   * @param slotId 设备 ID
   * @param channel 通道
   * @param value 强度
   * @param options 选项
   * @return V4SendPromise<unknown>
   */
  reduceStrength(
    clientId: string,
    slotId: string,
    channel: V4Channel,
    value: number,
    options?: V4OperateOptions,
  ) {
    return this.addIntensity(clientId, slotId, channel, -value, options);
  }

  /**
   * 设置临时强度
   * @param clientId 被控方 ID
   * @param slotId 设备 ID
   * @param channel 通道
   * @param value 强度
   * @param options 选项
   * @param duration 持续时长
   * @return V4SendPromise<unknown>
   */
  setTempIntensity(
    clientId: string,
    slotId: string,
    channel: V4Channel,
    value: number,
    duration: number,
    options?: V4OperateOptions,
  ): V4SendPromise {
    // 临时强度是持续类任务，可通过 duration 控制持续时间
    return this.rpc.sendOperate(
      clientId,
      {
        ...this.createOperateBase(slotId, channel, options),
        t: V4Action.SetTempIntensity,
        v: value,
        d: duration,
      },
      options,
    );
  }

  /**
   * 设置强度为 0
   * @param clientId 被控方 ID
   * @param slotId 设备 ID
   * @param channel 通道
   * @param options 选项
   * @return V4SendPromise<unknown>
   */
  resetIntensity(
    clientId: string,
    slotId: string,
    channel: V4Channel,
    options?: V4OperateOptions,
  ): V4SendPromise {
    return this.rpc.sendOperate(
      clientId,
      {
        ...this.createOperateBase(slotId, channel, options),
        t: V4Action.SetIntensity,
        v: 0,
      },
      options,
    );
  }

  /**
   * 下发波形数据
   * @param clientId 被控方 ID
   * @param slotId 设备 ID
   * @param channel 通道
   * @param duration 持续时长
   * @param frames 波形帧
   * @param options 选项
   * @return V4SendPromise<unknown>
   */
  sendPulse(
    clientId: string,
    slotId: string,
    channel: V4Channel,
    duration: number,
    frames: V4AppendPulseDataOperate['v'],
    options?: V4AppendPulseDataOptions,
  ): V4SendPromise {
    // 裸波形数据每 tick 消费一帧
    return this.rpc.sendOperate(
      clientId,
      {
        ...this.createOperateBase(slotId, channel, options),
        t: V4Action.AppendPulseData,
        d: duration,
        v: frames,
        ver: options?.version,
        seq: options?.seq,
      },
      options,
    );
  }

  /**
   * 清理波形数据
   * @param clientId 被控方 ID
   * @param slotId 设备 ID
   * @param channel 通道
   * @return V4SendPromise<unknown>
   * */
  clearPulse(clientId: string, slotId: string, channel: V4Channel) {
    return this.clearOperate(clientId, { slotId, channel });
  }

  /**
   * 清理任务
   * 可清理特定通道/设备的任务，也可清理全部任务
   * @param clientId 被控方 ID
   * @param options 选项
   * @return V4SendPromise<unknown>
   * */
  clearOperate(
    clientId: string,
    options?: V4ClearOperateOptions,
  ): V4SendPromise {
    // 不传 slotId 时清理全部任务，传 channel 时清理指定通道
    const data =
      options && 'slotId' in options && options.slotId
        ? { s: options.slotId, c: options.channel }
        : undefined;

    return this.rpc.send(
      clientId,
      this.rpc.createRequest('device.op.clear', data),
    );
  }

  /**
   * 处理协议消息
   * @param text 文本消息
   * @param _raw 原始消息
   * */
  protected handleProtocolMessage(
    text: string,
    _raw: DglabSocketIncoming,
  ): void {
    let frame: V4ServerFrame | undefined;

    // 尝试解析为 JSON
    try {
      frame = JSON.parse(text) as unknown as V4ServerFrame;
    } catch {
      return;
    }
    if (!frame) return;

    // 派发所有帧事件
    this.dispatch('frame', frame);

    switch (frame.type) {
      case 'hello': // hello 代表控制方连接建立完成，clientId 需要展示给被控方
        this.handleHello(frame);
        return;
      case 'client_attached': {
        this.setState(DGLAB_SOCKET_STATE.Paired);

        const clientId = frame.clientId;

        this.ensureClient(clientId);
        this.dispatch('client-attached', clientId);
        return;
      }
      case 'client_disconnected': {
        const clientId = frame.clientId;

        this.detachClient(clientId);
        this.rpc.rejectClientPending(clientId);

        if (this.clientMap.size === 0) {
          this.setState(DGLAB_SOCKET_STATE.WaitingForPeer);
        }

        this.dispatch('client-disconnected', clientId);
        return;
      }
      case 'message':
        this.handleMessage(frame);
        return;
      case 'idle_timeout': // 控制方空闲超时
        this.handleSocketError(
          createNamedError('socket-idle-timeout', '控制方空闲超时'),
        );
        return;
      case 'error': // 错误帧处理
        this.handleSocketError(
          createNamedError('socket-v4-server', frame.message ?? frame.code),
        );
    }
  }

  protected onSocketClosed(): void {
    this._targetId = undefined;
    this._secret = undefined;

    for (const client of this.clientMap.values()) {
      client.destroy();
    }
    this.clientMap.clear();

    this.rpc.rejectAllPending(
      createNamedError('socket-disconnected', 'WebSocket 已断开'),
    );
  }

  /**
   * 获取连接结果
   * - targetId: 被控端 ID
   * - secret: HTTP 鉴权密钥
   * @return DglabSocketConnectResult | undefined
   * */
  protected getConnectedResult(): DglabSocketConnectResult | undefined {
    if (!this._targetId) return undefined;
    return { targetId: this._targetId, secret: this._secret };
  }

  /**
   * 处理 hello 帧，获取被控端 ID 和 HTTP 鉴权密钥
   * @param frame V4HelloFrame
   * */
  private handleHello(frame: V4HelloFrame): void {
    // 测试服务返回 secret，旧文档服务可能返回 apikey
    this._targetId = frame.clientId;
    this._secret = frame.secret;

    this.setState(DGLAB_SOCKET_STATE.WaitingForPeer);

    this.resolveActiveConnect({
      targetId: frame.clientId,
      secret: this._secret,
    });
  }

  /**
   * 处理被控方断开
   * @param clientId 被控方 ID
   */
  private detachClient(clientId: string): void {
    const client = this.clientMap.get(clientId);
    client?.destroy();
    this.clientMap.delete(clientId);
  }

  /**
   * 处理 SOCKET 消息
   * @param frame V4MessageFrame
   * */
  private handleMessage(frame: V4MessageFrame): void {
    const data: V4RpcResponse | unknown = frame.data;

    // 派发所有消息
    this.dispatch('data', data, frame.clientId);

    const client = this.clientMap.get(frame.clientId);
    for (const event of this.createDeviceEvents(data, client)) {
      this.dispatch('device', event, frame.clientId);
    }

    if (client?.dispatch(data)) {
      this.dispatch('devices', client.devices, client.clientId);
    }

    // 如果不是 RPC 响应帧则不处理后续响应等待
    if (!V4Rpc.isResponse(data)) return;

    // 只有响应帧且 requestId 匹配时才完成响应等待
    this.rpc.resolveResponse(frame.clientId, data);
  }

  /**
   * 确保被控方连接存在
   * @param clientId 被控方 ID
   */
  private ensureClient(clientId: string): V4Client {
    let client = this.clientMap.get(clientId);
    if (!client) {
      client = new V4Client(clientId);
      this.clientMap.set(clientId, client);
    }
    return client;
  }

  /**
   * 根据设备事件生成单设备事件
   * @param data 上行数据
   * @param client 被控方状态
   */
  private createDeviceEvents(
    data: unknown,
    client: V4Client | undefined,
  ): V4DeviceEventPayload[] {
    if (!this.isEventRecord(data)) return [];

    if (data.ev === 'devices.snapshot') {
      const devices = Array.isArray(data.devices)
        ? (data.devices as V4DeviceInfo[])
        : [];
      const changed = devices
        .map((device) => this.createDeviceUpsertEvent(device, client))
        .filter((event) => event !== undefined);
      const nextSlotIds = new Set(devices.map((device) => device.slotId));
      const removed =
        client?.devices
          .filter((device) => !nextSlotIds.has(device.slotId))
          .map((device) => ({ slotId: device.slotId, removed: true as const })) ??
        [];
      return [...changed, ...removed];
    }

    if (data.ev === 'devices.patch') {
      const added = Array.isArray(data.added)
        ? (data.added as V4DeviceInfo[])
        : [];
      const removed = Array.isArray(data.removed)
        ? (data.removed as string[])
        : [];

      return [
        ...added
          .map((device) => this.createDeviceUpsertEvent(device, client))
          .filter((event) => event !== undefined),
        ...removed.map((slotId) => ({ slotId, removed: true as const })),
      ];
    }

    if (data.ev === 'slots.patch') {
      return Array.isArray(data.slots)
        ? (data.slots as V4DeviceEventPayload[])
        : [];
    }

    return [];
  }

  private createDeviceUpsertEvent(
    device: V4DeviceInfo,
    client: V4Client | undefined,
  ): V4DeviceEventPayload | undefined {
    const previous = client?.getDevice(device.slotId);
    if (!previous) return device;

    const event: Partial<V4DeviceInfo> & { slotId: string } = {
      slotId: device.slotId,
    };
    if (previous.name !== device.name) event.name = device.name;
    if (previous.type !== device.type) event.type = device.type;
    if (!this.isEqualValue(previous.props, device.props)) {
      event.props = device.props;
    }
    if (!this.isEqualValue(previous.slotState, device.slotState)) {
      event.slotState = device.slotState;
    }

    return Object.keys(event).length > 1 ? event : undefined;
  }

  private isEqualValue(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private isEventRecord(data: unknown): data is Record<string, unknown> & {
    t: 'ev';
    ev: string;
  } {
    return (
      typeof data === 'object' &&
      data !== null &&
      't' in data &&
      data.t === 'ev' &&
      'ev' in data &&
      typeof data.ev === 'string'
    );
  }

  /**
   * 创建 device.op 指令基础数据
   * @param slotId 设备 ID
   * @param channel 通道
   * @param options 选项
   * */
  private createOperateBase(
    slotId: string,
    channel: V4Channel,
    options?: V4OperateOptions,
  ): Pick<V4DeviceOperate, 's' | 'c' | 'p' | 'd' | 'im'> {
    return {
      s: slotId,
      c: channel,
      p: options?.priority,
      im: options?.immediate,
    };
  }
}

export * from './types';
