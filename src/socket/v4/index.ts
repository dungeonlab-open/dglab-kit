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
   * @param clientId 被控方 ID，不传时使用最近接入的被控方
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
      request,
      { clientId },
    );

    const client = this.ensureClient(clientId);
    if (client.dispatch({ t: 'resp', result })) {
      this.dispatch('devices', client.devices, client.clientId);
    }

    return result;
  }

  /**
   * 发送协议数据
   * @param data 数据
   * @param options 选项
   * @return V4SendPromise<TResponse>
   */
  send<TData = unknown, TResponse = unknown>(
    data: TData,
    options?: V4SendOptions,
  ): V4SendPromise<TResponse> {
    return this.rpc.send(data, options);
  }

  /**
   * 增加强度（相对）
   * @param slotId 设备 ID
   * @param channel 通道
   * @param value 强度
   * @param options 选项
   * @return V4SendPromise<unknown>
   */
  addIntensity(
    slotId: string,
    channel: V4Channel,
    value: number,
    options?: V4OperateOptions,
  ): V4SendPromise {
    // 相对增减强度使用 device.op 的 AddIntensity 任务
    return this.rpc.sendOperate(
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
   * @param slotId 设备 ID
   * @param channel 通道
   * @param value 强度
   * @param options 选项
   * @return V4SendPromise<unknown>
   */
  reduceStrength(
    slotId: string,
    channel: V4Channel,
    value: number,
    options?: V4OperateOptions,
  ) {
    return this.addIntensity(slotId, channel, -value, options);
  }

  /**
   * 设置临时强度
   * @param slotId 设备 ID
   * @param channel 通道
   * @param value 强度
   * @param options 选项
   * @return V4SendPromise<unknown>
   */
  setTempIntensity(
    slotId: string,
    channel: V4Channel,
    value: number,
    options?: V4OperateOptions,
  ): V4SendPromise {
    // 临时强度是持续类任务，可通过 duration 控制持续时间
    return this.rpc.sendOperate(
      {
        ...this.createOperateBase(slotId, channel, options),
        t: V4Action.SetTempIntensity,
        v: value,
      },
      options,
    );
  }

  /**
   * 设置屏蔽通道输出
   * @param slotId 设备 ID
   * @param channel 通道
   * @param muted 是否屏蔽
   * @param options 选项
   * @return V4SendPromise<unknown>
   */
  setMute(
    slotId: string,
    channel: V4Channel,
    muted: boolean,
    options?: V4OperateOptions,
  ): V4SendPromise {
    // 静音状态是 oneShot 任务
    return this.rpc.sendOperate(
      {
        ...this.createOperateBase(slotId, channel, options),
        t: V4Action.SetMute,
        v: muted,
      },
      options,
    );
  }

  /**
   * 设置强度（绝对）
   * @param slotId 设备 ID
   * @param channel 通道
   * @param value 强度
   * @param options 选项
   * @return V4SendPromise<unknown>
   */
  setIntensity(
    slotId: string,
    channel: V4Channel,
    value: number,
    options?: V4OperateOptions,
  ): V4SendPromise {
    // 绝对强度任务用于直接设置目标强度
    return this.rpc.sendOperate(
      {
        ...this.createOperateBase(slotId, channel, options),
        t: V4Action.SetIntensity,
        v: value,
      },
      options,
    );
  }

  /**
   * 下发波形数据
   * @param slotId 设备 ID
   * @param channel 通道
   * @param duration 持续时长
   * @param frames 波形帧
   * @param options 选项
   * @return V4SendPromise<unknown>
   */
  sendPulse(
    slotId: string,
    channel: V4Channel,
    duration: number,
    frames: V4AppendPulseDataOperate['v'],
    options?: V4AppendPulseDataOptions,
  ): V4SendPromise {
    // 裸波形数据每 tick 消费一帧
    return this.rpc.sendOperate(
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
   * @param slotId 设备 ID
   * @param channel 通道
   * @return V4SendPromise<unknown>
   * */
  clearPulse(slotId: string, channel: V4Channel) {
    return this.clearOperate({ slotId, channel });
  }

  /**
   * 清理任务
   * 可清理特定通道/设备的任务，也可清理全部任务
   * @param options 选项
   * @return V4SendPromise<unknown>
   * */
  clearOperate(options?: V4ClearOperateOptions): V4SendPromise {
    // 不传 slotId 时清理全部任务，传 channel 时清理指定通道
    const data =
      options && 'slotId' in options && options.slotId
        ? { s: options.slotId, c: options.channel }
        : undefined;

    return this.rpc.send(
      this.rpc.createRequest('device.op.clear', data),
      options?.clientId ? { clientId: options.clientId } : undefined,
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
        this.dispatch('clientAttached', clientId);
        return;
      }
      case 'client_disconnected': {
        if (this.clientMap.size === 0) {
          this.setState(DGLAB_SOCKET_STATE.WaitingForPeer);
        }

        const clientId = frame.clientId;

        this.detachClient(clientId);
        this.rpc.rejectClientPending(clientId);
        this.dispatch('clientDisconnected', clientId);
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
      d: options?.duration,
      im: options?.immediate,
    };
  }
}

export * from './types';
