import { createNamedError, isRecord } from '@/shared';
import {
  DGLAB_SOCKET_STATE,
  type DglabSocketConnectResult,
  type DglabSocketIncoming,
} from '@/socket';
import { DglabSocketBase } from '@/socket/base';
import type {
  V4AnyRpcPayload,
  V4AppendPulseDataOperate,
  V4AppendPulseDataOptions,
  V4CachedDevices,
  V4Channel,
  V4ClearOperateOptions,
  V4DeviceInfo,
  V4DeviceOperate,
  V4DevicesGetResult,
  V4EventPayload,
  V4HelloFrame,
  V4MessageFrame,
  V4OperateOptions,
  V4PendingResponse,
  V4RpcRequest,
  V4RpcResponse,
  V4SendOptions,
  V4SendPromise,
  V4ServerFrame,
  V4SlotPatch,
} from './types';
import { V4ActionType as V4Action } from './types';

export class DglabSocketV4 extends DglabSocketBase {
  private targetId?: string; // 被控端 ID
  private _secret?: string; // HTTP 密钥

  private readonly clients = new Set<string>(); // 已接入被控端 clientId 集合
  private readonly pending = new Map<string, V4PendingResponse>(); // 等待响应集合
  private readonly deviceCaches = new Map<string, Map<string, V4DeviceInfo>>(); // 设备缓存集合

  /**
   * 获取被控端 ID
   * @return string | undefined
   */
  get targetClientId(): string | undefined {
    return this.targetId;
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
    return [...this.clients];
  }

  /**
   * 获取指定被控端当前设备列表
   * @param clientId 被控端 ID
   * @return V4DeviceInfo[]
   */
  getDevices(clientId?: string): V4DeviceInfo[] {
    if (!clientId) return [];
    return [...(this.deviceCaches.get(clientId)?.values() ?? [])].map(
      (device) => this.cloneDevice(device),
    );
  }

  /**
   * 获取当前所有设备列表
   * @return V4CachedDevices[]
   */
  getAllDevices(): V4CachedDevices[] {
    // 多被控方场景下返回每个 clientId 对应的设备列表
    return [...this.deviceCaches].map(([clientId, devices]) => ({
      clientId,
      devices: [...devices.values()].map((device) => this.cloneDevice(device)),
    }));
  }

  /**
   * 请求最新设备列表
   * @param clientId ? 被控端 ID
   * @return Promise<V4DevicesGetResult>
   */
  async requestDevices(clientId?: string): Promise<V4DevicesGetResult> {
    const target = this.resolveClientId(clientId);
    const request = this.createRpcRequest('devices.get');
    const result = await this.send<V4RpcRequest, V4DevicesGetResult>(request, {
      clientId: target,
    });
    this.replaceDevices(target, result.devices);
    this.dispatch('devices', this.getDevices(target), target);
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
    let clientId: string | undefined;
    let requestId: string | undefined;

    try {
      // V4 所有控制方业务消息都要包进外层 message 路由帧
      clientId = this.resolveClientId(options?.clientId);
      const existingRequestId = this.getV4RequestId(data);
      requestId = existingRequestId ?? this.createRequestId();
      let payload: V4AnyRpcPayload;

      if (isRecord(data)) {
        if (!requestId || this.getV4RequestId(data))
          payload = data as V4AnyRpcPayload;
        payload = { ...data, requestId, reqId: requestId } as V4AnyRpcPayload;
      } else {
        payload = {
          t: 'req',
          requestId: requestId ?? Date.now(),
          reqId: requestId,
          m: 'custom',
          data,
        };
      }

      const waitableRequestId = this.getV4RequestId(payload);
      let entry: V4PendingResponse<TResponse> | undefined;
      if (waitableRequestId !== undefined) {
        const key = this.pendingKey(clientId, waitableRequestId);
        let resolve!: V4PendingResponse<TResponse>['resolve'];
        let reject!: V4PendingResponse<TResponse>['reject'];
        const promise = new Promise<TResponse>((innerResolve, innerReject) => {
          resolve = innerResolve;
          reject = innerReject;
        });
        const pending: V4PendingResponse<TResponse> = {
          clientId,
          requestId: waitableRequestId,
          promise,
          resolve,
          reject,
          settled: false,
        };
        pending.timer = setTimeout(() => {
          this.pending.delete(key);
          this.rejectPending(
            pending,
            createNamedError('socket-response-timeout', '等待响应超时'),
          );
        }, options?.timeout ?? this.responseTimeout());

        entry = pending;
        this.pending.set(key, pending as V4PendingResponse);
      }
      let error: unknown =
        waitableRequestId === undefined
          ? createNamedError('socket-command', '当前消息没有可等待响应')
          : undefined;

      try {
        // 创建发送给中继服务的外层路由帧
        this.sendFrame({
          type: 'message',
          clientId,
          data: payload,
        });
      } catch (sendError) {
        error = sendError;
        if (entry && waitableRequestId !== undefined) {
          this.pending.delete(this.pendingKey(clientId, waitableRequestId));
          this.rejectPending(entry, sendError);
        }
      }

      const promise = entry?.promise ?? Promise.reject<TResponse>(error);
      Object.assign(promise, { requestId, clientId });
      return promise as V4SendPromise<TResponse>;
    } catch (error) {
      const promise = Promise.reject<TResponse>(error);
      Object.assign(promise, { requestId, clientId });
      return promise as V4SendPromise<TResponse>;
    }
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
    return this.sendOperate(
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
    return this.sendOperate(
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
    return this.sendOperate(
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
    return this.sendOperate(
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
    return this.sendOperate(
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
    return this.send(
      this.createRpcRequest('device.op.clear', data),
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
        // 记录最近接入的被控方
        this.clients.add(frame.clientId);
        this.setState(DGLAB_SOCKET_STATE.Paired);
        this.dispatch('clientAttached', frame.clientId);
        return;
      }
      case 'client_disconnected': {
        // 被控方断开时清理默认目标和对应等待项
        this.clients.delete(frame.clientId);
        this.deviceCaches.delete(frame.clientId);
        if (this.clients.size === 0) {
          this.setState(DGLAB_SOCKET_STATE.WaitingForPeer);
        }
        this.rejectClientPending(frame.clientId);
        this.dispatch('clientDisconnected', frame.clientId);
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
    this.targetId = undefined;
    this._secret = undefined;
    this.clients.clear();
    this.deviceCaches.clear();
    this.rejectAllPending(
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
    if (!this.targetId) return undefined;
    return { targetId: this.targetId, secret: this._secret };
  }

  /**
   * 处理 hello 帧，获取被控端 ID 和 HTTP 鉴权密钥
   * @param frame V4HelloFrame
   * */
  private handleHello(frame: V4HelloFrame): void {
    // 测试服务返回 secret，旧文档服务可能返回 apikey
    this.targetId = frame.clientId;
    this._secret = frame.secret;
    this.setState(DGLAB_SOCKET_STATE.WaitingForPeer);
    this.resolveActiveConnect({
      targetId: frame.clientId,
      secret: this._secret,
    });
  }

  /**
   * 处理 SOCKET 消息
   * @param frame V4MessageFrame
   * */
  private handleMessage(frame: V4MessageFrame): void {
    const data: V4RpcResponse | unknown = frame.data;

    // 派发所有消息
    this.dispatch('data', data, frame.clientId);

    // 更新设备缓存，V4 被控方事件会主动维护设备缓存，控制方无需轮询设备列表
    this.updateDevicesFromEvent(frame.clientId, data);

    // 如果不是 RPC 响应帧则不处理后续响应等待
    if (!this.isV4RpcResponse(data)) return;

    // 响应帧可能包含最新设备列表，更新缓存并派发 devices 事件
    if (this.updateDevicesFromResponse(frame.clientId, data.result)) {
      this.dispatch('devices', this.getDevices(frame.clientId), frame.clientId);
    }

    // 只有响应帧且 requestId 匹配时才完成响应等待
    const requestId = this.getV4RequestId(data);
    if (!requestId) return;
    const key = this.pendingKey(frame.clientId, requestId);
    const entry = this.pending.get(key);
    if (!entry) return;

    this.pending.delete(key);

    // 完成等待中的响应，响应 error 会作为 reject 抛出
    if (data.error) {
      this.rejectPending(
        entry,
        createNamedError('socket-v4-response', data.error ?? 'V4 指令执行失败'),
      );
      return;
    }

    // 完成等待中的响应
    if (entry.settled) return;
    entry.settled = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(data.result);
  }

  /**
   * 判断是否为 V4 RPC 响应帧
   * @param data 帧数据
   * @return data is V4RpcResponse
   * */
  private isV4RpcResponse(data: unknown): data is V4RpcResponse {
    return isRecord(data) && data.t === 'resp';
  }

  /**
   * 更新设备缓存
   * V4 被控方事件会主动维护设备缓存，控制方无需轮询设备列表
   * @param clientId 被控端 ID
   * @param data 帧数据
   * */
  private updateDevicesFromEvent(clientId: string, data: unknown): void {
    if (!this.isV4EventPayload(data)) return;

    // 处理全量设备列表
    if (data.ev === 'devices.snapshot') {
      this.replaceDevices(clientId, data.devices);
      this.dispatch('devices', this.getDevices(clientId), clientId);
      return;
    }

    // 处理增量设备列表
    if (data.ev === 'devices.patch') {
      this.patchDevices(clientId, data.added ?? [], data.removed ?? []);
      this.dispatch('devices', this.getDevices(clientId), clientId);
      return;
    }

    // 处理设备属性 patch
    if (data.ev === 'slots.patch') {
      this.patchSlots(clientId, data.slots ?? []);
      this.dispatch('devices', this.getDevices(clientId), clientId);
    }
  }

  /**
   * 更新设备缓存
   * V4 devices.get 返回全量描述列表，也需要同步刷新本地缓存
   * @param clientId 被控端 ID
   * @param result RPC 响应结果
   * @return boolean 是否更新成功
   * */
  private updateDevicesFromResponse(
    clientId: string,
    result: unknown,
  ): boolean {
    if (!this.hasDevicesResult(result)) return false;
    this.replaceDevices(clientId, result.devices);
    return true;
  }

  /**
   * 替换设备缓存
   * @param clientId 被控端 ID
   * @param devices 设备列表
   * */
  private replaceDevices(clientId: string, devices: V4DeviceInfo[]): void {
    // 全量事件直接替换该被控方的设备列表
    const cache = new Map<string, V4DeviceInfo>();
    for (const device of devices) {
      cache.set(device.slotId, this.cloneDevice(device));
    }
    this.deviceCaches.set(clientId, cache);
  }

  /**
   * 增量更新设备缓存
   * @param clientId 被控端 ID
   * @param added 新增设备列表
   * @param removed 移除设备 slotId 列表
   * */
  private patchDevices(
    clientId: string,
    added: V4DeviceInfo[],
    removed: string[],
  ): void {
    // 增量事件只变更对应 slot，避免丢失其他设备状态
    const cache = this.ensureDeviceCache(clientId);
    for (const device of added) {
      cache.set(device.slotId, this.cloneDevice(device));
    }
    for (const slotId of removed) {
      cache.delete(slotId);
    }
  }

  /**
   * 增量更新插槽缓存
   * @param clientId 被控端 ID
   * @param slots 插槽增量列表
   * */
  private patchSlots(clientId: string, slots: V4SlotPatch[]): void {
    const cache = this.ensureDeviceCache(clientId);
    for (const slot of slots) {
      const current = cache.get(slot.slotId);
      if (!current) continue;

      // 合并 props 和 slotState
      cache.set(slot.slotId, {
        ...current,
        props: { ...(current.props ?? {}), ...(slot.props ?? {}) },
        slotState: {
          ...(current.slotState ?? {}),
          ...(slot.slotState ?? {}),
        },
      });
    }
  }

  /**
   * 确保被控端设备缓存存在
   * @param clientId 被控端 ID
   * */
  private ensureDeviceCache(clientId: string): Map<string, V4DeviceInfo> {
    let cache = this.deviceCaches.get(clientId);
    if (!cache) {
      cache = new Map();
      this.deviceCaches.set(clientId, cache);
    }
    return cache;
  }

  /**
   * 克隆设备信息，避免外部对象突变影响缓存
   * @param device 设备信息
   * */
  private cloneDevice(device: V4DeviceInfo): V4DeviceInfo {
    return {
      ...device,
      props: device.props ? { ...device.props } : undefined,
      slotState: device.slotState ? { ...device.slotState } : undefined,
    };
  }

  /**
   * 判断是否为 V4 事件负载
   * @param data 帧数据
   * */
  private isV4EventPayload(data: unknown): data is V4EventPayload {
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
   * 判断是否为 V4 devices.get 响应结果
   * */
  private hasDevicesResult(
    result: unknown,
  ): result is { devices: V4DeviceInfo[] } {
    return (
      typeof result === 'object' &&
      result !== null &&
      'devices' in result &&
      Array.isArray(result.devices)
    );
  }

  /**
   * 创建 V4 RPC 请求
   * @param method RPC 方法名
   * @param data 请求数据
   */
  private createRpcRequest<TData>(
    method: string,
    data?: TData,
  ): V4RpcRequest<TData> {
    const requestId = this.createRequestId();
    return {
      t: 'req',
      reqId: requestId,
      requestId,
      m: method,
      data,
    };
  }

  /**
   * 发送 device.op 指令
   * @param data 指令数据
   * @param options 选项
   * */
  private sendOperate(
    data: V4DeviceOperate,
    options?: V4OperateOptions,
  ): V4SendPromise {
    return this.send(this.createRpcRequest('device.op', data), {
      clientId: options?.clientId,
      timeout: options?.timeout,
    });
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

  /**
   * 创建唯一请求 ID
   */
  private createRequestId(): string {
    return `v4-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 解析被控端 clientId，未指定时抛出错误
   * @param clientId 被控端 ID
   * @return string
   * */
  private resolveClientId(clientId?: string): string {
    // V4 可以有多个被控方
    if (!clientId) {
      throw createNamedError('socket-target', '尚未指定或接入被控方 clientId');
    }
    return clientId;
  }

  /**
   * 获取等待响应键，按被控方和请求 ID 组合，避免多被控方请求互相串扰
   * @param clientId 被控端 ID
   * @param requestId 请求 ID
   * */
  private pendingKey(clientId: string, requestId: string): string {
    return `${clientId}\u0000${requestId}`;
  }

  /**
   * 拒绝指定被控端的所有待完成指令
   * @param clientId 被控端 ID
   * */
  private rejectClientPending(clientId: string): void {
    // 被控方断开时只拒绝它自己的待完成指令
    for (const [key, entry] of this.pending) {
      if (entry.clientId !== clientId) continue;
      this.pending.delete(key);
      this.rejectPending(
        entry,
        createNamedError('socket-disconnected', '被控方已断开'),
      );
    }
  }

  /**
   * 拒绝所有待完成指令
   * @param error 错误对象
   * */
  private rejectAllPending(error: Error): void {
    // 控制方连接断开时拒绝所有待完成指令
    for (const [, entry] of this.pending) {
      this.rejectPending(entry, error);
    }
    this.pending.clear();
  }

  /**
   * 获取 V4 请求 ID
   * @param data 帧数据
   * @return string | undefined
   * */
  private getV4RequestId(data: unknown): string | undefined {
    if (!isRecord(data)) return undefined;
    if (typeof data.requestId === 'string') return data.requestId;
    if (typeof data.reqId === 'string') return data.reqId;
    return undefined;
  }

  /**
   * 拒绝响应等待，已经完成的槽会忽略后续错误
   * @param entry 响应等待槽
   * @param error 错误对象
   * */
  private rejectPending<T>(entry: V4PendingResponse<T>, error: unknown): void {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.reject(error);
  }
}

export * from './types';
