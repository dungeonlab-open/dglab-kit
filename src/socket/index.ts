import EventEmitter from 'eventemitter3';
import type { DglabSocketBase } from './base';
import {
  DGLAB_SOCKET_VERSION,
  type DglabSendOptions,
  type DglabSocketEventMap,
  type DglabSocketOptions,
  type DglabSocketOutgoing,
  type DglabSocketV3Options,
  type DglabSocketV4Options,
} from './base/types';
import { DglabSocketV3 } from './v3';
import type { V4SendPromise } from './v4';
import { DglabSocketV4 } from './v4';

const socketEvents = [
  'message',
  'state',
  'open',
  'close',
  'error',
  'frame',
  'data',
  'devices',
  'clientAttached',
  'clientDisconnected',
] as const satisfies readonly (keyof DglabSocketEventMap)[];

type DglabSocketAdapter = DglabSocketV3 | DglabSocketV4;

class DglabSocketImpl extends EventEmitter<DglabSocketEventMap> {
  private readonly adapter: DglabSocketAdapter;
  private readonly adapterEventCleanups: (() => void)[] = [];

  /**
   * DG-LAB SOCKET
   * @param options 连接配置，不传入时可使用自定义 WebSocket 实现
   */
  constructor(options: DglabSocketOptions = {}) {
    super();

    const version = options.version ?? DGLAB_SOCKET_VERSION.V4;
    this.adapter =
      version === DGLAB_SOCKET_VERSION.V3
        ? new DglabSocketV3(options)
        : new DglabSocketV4(options);

    // 转发事件
    this.forwardAdapterEvents();
  }

  /**
   * 当前 Socket 连接状态
   */
  get state(): DglabSocketV3['state'] | DglabSocketV4['state'] {
    return this.adapter.state;
  }

  /**
   * 连接 WebSocket
   */
  connect(): ReturnType<DglabSocketV3['connect']> {
    return this.adapter.connect();
  }

  /**
   * 发送协议数据
   * V3: send(data)
   * V4: send(clientId, data, options)
   * @param clientIdOrData V3 数据或 V4 被控方 ID
   * @param data V4 要发送的数据
   * @param options 选项
   */
  send<TData = unknown, TResponse = unknown>(
    clientIdOrData: string | TData,
    data?: TData,
    options?: DglabSendOptions,
  ): undefined | V4SendPromise<TResponse> {
    if (this.adapter instanceof DglabSocketV3) {
      this.adapter.send(clientIdOrData);
      return;
    }
    return this.adapter.send<TData, TResponse>(
      clientIdOrData as string,
      data as TData,
      options,
    );
  }

  /**
   * 断开当前 Socket 连接
   * @param code 关闭码
   * @param reason 关闭原因
   */
  disconnect(code?: number, reason?: string): void {
    this.adapter.disconnect(code, reason);
  }

  /**
   * 销毁当前 Socket 实例
   * @param code 关闭码
   * @param reason 关闭原因
   */
  destroy(code?: number, reason?: string): void {
    try {
      this.disconnect(code, reason);
    } finally {
      for (const cleanup of this.adapterEventCleanups) cleanup();
      this.adapterEventCleanups.length = 0;
      this.adapter.removeAllListeners();
      this.removeAllListeners();
    }
  }

  /**
   * 绑定手动传输模式下的 Websocket 数据发送
   * @param sender 数据发送处理函数
   */
  setSender(sender: (data: DglabSocketOutgoing) => void): this {
    this.adapter.setSender(sender);
    return this;
  }

  /**
   * 发送原始 WebSocket 数据
   * @param data 要发送的原始 WebSocket 数据
   */
  sendRaw(data: DglabSocketOutgoing): void {
    this.adapter.sendRaw(data);
  }

  /**
   * 处理手动传输模式收到的 MESSAGE 数据
   * @param data WebSocket 收到的原始消息数据
   */
  handleMessage(data: unknown): void {
    this.adapter.handleSocketMessage(data as never);
  }

  /**
   * 处理手动传输模式的 OPEN 事件
   * @param event WebSocket 实现产生的 open 事件对象
   */
  handleOpen(event?: unknown): void {
    this.adapter.handleSocketOpen(event);
  }

  /**
   * 处理手动传输模式的 CLOSE 事件
   * @param eventOrCode 浏览器 CloseEvent、Node ws close code
   * @param reason Node ws close reason；浏览器 CloseEvent 场景通常不需要传
   */
  handleClose(eventOrCode?: unknown, reason?: unknown): void {
    this.adapter.handleSocketClose(eventOrCode, reason);
  }

  /**
   * 处理手动传输模式的 ERROR 事件
   * @param error WebSocket 或传输层产生的错误对象
   */
  handleError(error: unknown): void {
    this.adapter.handleSocketError(error);
  }

  createAdapterProxy(): this {
    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (property in target) {
          return Reflect.get(target, property, receiver);
        }

        if (property in target.adapter) {
          const value = Reflect.get(target.adapter, property, target.adapter);
          return typeof value === 'function'
            ? value.bind(target.adapter)
            : value;
        }

        return undefined;
      },
      has: (target, property) =>
        property in target || property in target.adapter,
    });
  }

  /**
   * 转发底层事件
   */
  private forwardAdapterEvents(): void {
    for (const event of socketEvents) {
      this.forwardAdapterEvent(event);
    }
  }

  /**
   * 转发单个底层事件
   * @param event 事件名
   */
  private forwardAdapterEvent<K extends keyof DglabSocketEventMap>(
    event: K,
  ): void {
    const listener = ((...args: Parameters<DglabSocketEventMap[K]>) => {
      const emit = this.emit.bind(this) as <
        K extends keyof DglabSocketEventMap,
      >(
        event: K,
        ...args: Parameters<DglabSocketEventMap[K]>
      ) => boolean;
      emit(event, ...args);
    }) as EventEmitter.EventListener<DglabSocketEventMap, K>;

    this.adapter.on(event, listener);
    this.adapterEventCleanups.push(() => this.adapter.off(event, listener));
  }
}

type EventEmitterKey = keyof EventEmitter<DglabSocketEventMap>;
type DglabSocketEventEmitterKey = 'emit' | 'on' | 'once' | 'off';
type DglabSocketEventEmitter = Pick<
  EventEmitter<DglabSocketEventMap>,
  DglabSocketEventEmitterKey
>;

type DglabSocketBaseKey = Exclude<
  Extract<keyof DglabSocketImpl, keyof DglabSocketBase>,
  EventEmitterKey
>;

type DglabSocketCommonKey =
  | Exclude<DglabSocketBaseKey, 'send' | 'setSender'>
  | 'destroy';

type DglabSocketAdapterKey<TAdapter> = Exclude<
  keyof TAdapter,
  keyof DglabSocketBase | EventEmitterKey
>;

type DglabSocketAdapterApi<TAdapter> = Pick<
  TAdapter,
  DglabSocketAdapterKey<TAdapter>
>;

type DglabSocketRawAdapter<TAdapter> = Pick<
  TAdapter,
  Exclude<keyof TAdapter, EventEmitterKey>
>;

type DglabManualSocketKey = Extract<
  keyof DglabSocketImpl,
  'setSender' | `handle${string}`
>;

/**
 * SOCKET 实例公共配置
 */
export type DglabSocketCommon<
  TAdapter extends DglabSocketAdapter = DglabSocketAdapter,
> = DglabSocketEventEmitter &
  Pick<DglabSocketImpl, DglabSocketCommonKey> & {
    readonly raw: DglabSocketRawAdapter<TAdapter>;
  };

/**
 * SOCKET V3 客户端
 * @deprecated 请使用 V4 协议
 */
export type DglabSocketV3Client = DglabSocketCommon<DglabSocketV3> &
  DglabSocketAdapterApi<DglabSocketV3> &
  Pick<DglabSocketV3, 'send'>;

/**
 * SOCKET V4 客户端
 */
export type DglabSocketV4Client = DglabSocketCommon<DglabSocketV4> &
  DglabSocketAdapterApi<DglabSocketV4> &
  Pick<DglabSocketV4, 'send'>;

/**
 * 使用自定义 Websocket 实现
 * */
export type DglabManualSocket = DglabSocketV4Client &
  Pick<DglabSocketImpl, DglabManualSocketKey>;

/**
 * 构造实例
 * */
export interface DglabSocketConstructor {
  new (): DglabManualSocket; // 支持自定义 Websocket 实现
  /**
   * @deprecated 请使用 V4 协议
   */
  new (options: DglabSocketV3Options): DglabSocketV3Client;
  new (options: DglabSocketV4Options): DglabSocketV4Client;
  new (options: DglabSocketOptions): DglabSocketV3Client | DglabSocketV4Client;
}

/**
 * DG-LAB SOCKET
 */
export const DglabSocket = new Proxy(DglabSocketImpl, {
  construct(target, args, newTarget) {
    const instance = Reflect.construct(target, args, newTarget);
    return instance.createAdapterProxy();
  },
}) as unknown as DglabSocketConstructor;

export type DglabSocket =
  | DglabManualSocket
  | DglabSocketV3Client
  | DglabSocketV4Client;

export * from './base/types';
export * from './v3/types';
export * from './v4/types';
