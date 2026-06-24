import EventEmitter from 'eventemitter3';
import { WebSocket as WsWebSocket } from 'ws';
import { createNamedError, isRecord } from '@/shared';
import {
  DGLAB_SOCKET_STATE,
  type DglabSendOptions,
  type DglabSocketCloseEvent,
  type DglabSocketConnectResult,
  type DglabSocketEventMap,
  type DglabSocketIncoming,
  type DglabSocketListenerCleanup,
  type DglabSocketOptions,
  type DglabSocketOutgoing,
  type DglabSocketSender,
  type DglabWebSocketLike,
} from './types';

// 默认连接超时
const DEFAULT_CONNECT_TIMEOUT = 8_000;

type DglabSocketEmit = <K extends keyof DglabSocketEventMap>(
  event: K,
  ...args: Parameters<DglabSocketEventMap[K]>
) => boolean;

interface ActiveConnect {
  promise: Promise<DglabSocketConnectResult>;
  resolve: (value: DglabSocketConnectResult) => void;
  reject: (reason?: unknown) => void;
}

export abstract class DglabSocketBase extends EventEmitter<DglabSocketEventMap> {
  protected readonly options: DglabSocketOptions; // SOCKET 选项
  protected socket?: DglabWebSocketLike; // SOCKET 实例

  private manualSender?: DglabSocketSender; // 手动发送函数
  private activeConnect?: ActiveConnect; // 连接等待
  private connectTimer?: ReturnType<typeof setTimeout>; // 连接超时计时器
  private cleanups: DglabSocketListenerCleanup[] = []; // 监听清理函数
  private currentState = DGLAB_SOCKET_STATE.Idle; // 当前状态

  constructor(options: DglabSocketOptions = {}) {
    super();
    this.options = options;
  }

  get state(): DGLAB_SOCKET_STATE {
    return this.currentState;
  }

  /**
   * 连接 SOCKET
   * @return Promise<DglabSocketConnectResult>
   * */
  connect(): Promise<DglabSocketConnectResult> {
    // 获取当前连接
    const activeResult = this.getConnectedResult();
    if (activeResult) return Promise.resolve(activeResult);

    // 如果存在连接等待，则返回等待结果
    if (this.activeConnect) return this.activeConnect.promise;

    // 准备 SOCKET 连接
    this.setState(DGLAB_SOCKET_STATE.Connecting);
    let resolve!: ActiveConnect['resolve'];
    let reject!: ActiveConnect['reject'];
    const promise = new Promise<DglabSocketConnectResult>(
      (innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
      },
    );
    const activeConnect: ActiveConnect = { promise, resolve, reject };
    this.activeConnect = activeConnect;
    this.connectTimer = setTimeout(() => {
      // 连接超时，拒绝连接等待
      this.rejectActiveConnect(
        createNamedError('socket-connect-timeout', '连接超时'),
      );
    }, this.connectTimeout());

    // 尝试创建 SOCKET
    try {
      this.openSocket();
    } catch (error) {
      this.rejectActiveConnect(
        error instanceof Error
          ? error
          : createNamedError('socket-connect', String(error)),
      );
      throw error;
    }

    // 返回连接等待结果
    return activeConnect.promise;
  }

  /**
   * 获取连接结果
   * targetId, secret (仅 V4 用于 HTTP 鉴权)
   * */
  protected abstract getConnectedResult(): DglabSocketConnectResult | undefined;

  /**
   * 发送协议数据
   * @param data 数据
   * @param options 发送选项，对于 V4 可传递 clientId 向特定的被控端发送数据
   * */
  abstract send(data: unknown, options?: DglabSendOptions): unknown;

  /**
   * 自定义协议数据发送（仅供使用自定义 Websocket 时使用）
   * @param sender 发送函数
   * */
  setSender(sender: DglabSocketSender): this {
    // 手动传输模式下用户需要把自己的发送函数绑定进来
    this.manualSender = sender;
    return this;
  }

  /**
   * 发送原始数据
   * @param data 原始数据
   */
  sendRaw(data: unknown): void {
    // 如果原始数据不是字符串或二进制 ArrayBuffer，则抛出错误
    if (
      !(
        typeof data === 'string' ||
        data instanceof ArrayBuffer ||
        ArrayBuffer.isView(data)
      )
    ) {
      throw createNamedError(
        'socket-send-error',
        '原始消息必须是字符串或二进制',
      );
    }

    const outgoing = data as DglabSocketOutgoing;

    // 如果存在手动发送函数，则使用手动发送函数
    if (this.manualSender) {
      this.manualSender(outgoing);
      return;
    }

    // 如果 SOCKET 未连接，则抛出错误
    if (
      !this.socket ||
      !(this.socket.readyState === undefined || this.socket.readyState === 1)
    ) {
      throw createNamedError('socket-send', 'WebSocket 尚未连接');
    }

    // 发送原始数据
    this.socket.send(outgoing);
  }

  /**
   * 发送协议帧
   * @param frame 协议帧
   */
  sendFrame(frame: unknown): void {
    this.sendRaw(JSON.stringify(frame));
  }

  /**
   * 断开 SOCKET 连接
   * @param code 关闭码
   * @param reason 关闭原因
   */
  disconnect(code?: number, reason?: string): void {
    // 断开时同时拒绝尚未完成的连接等待
    this.rejectActiveConnect(
      createNamedError('socket-connect-cancelled', '连接已取消'),
    );
    this.setState(DGLAB_SOCKET_STATE.Disconnected);

    // 关闭 SOCKET
    this.socket?.close(code, reason);

    // 分离监听
    this.detachListeners();
  }

  /**
   * 处理 WebSocket 打开事件
   * @param event 事件
   */
  handleSocketOpen(event?: unknown): void {
    // 暴露给自定义 WebSocket 的 open 事件入口
    this.dispatch('open', event);
  }

  /**
   * 处理 WebSocket 消息
   * @param data 消息
   */
  handleSocketMessage(data: DglabSocketIncoming): void {
    // 转换为字符串
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    } else if (ArrayBuffer.isView(data)) {
      const bytes = new Uint8Array(
        data.buffer as ArrayBuffer,
        data.byteOffset,
        data.byteLength,
      );
      text = new TextDecoder().decode(bytes);
    } else if (data && typeof data.toString === 'function') {
      text = data.toString();
    } else {
      text = String(data);
    }

    // 派发消息事件
    this.dispatch('message', text, data);

    // 处理协议消息
    this.handleProtocolMessage(text, data);
  }

  /**
   * 处理 WebSocket 关闭事件
   * @param eventOrCode 事件或关闭码
   * @param reasonValue 关闭原因
   */
  handleSocketClose(eventOrCode?: unknown, reasonValue?: unknown): void {
    // 转换为关闭事件
    let closeEvent: DglabSocketCloseEvent;
    if (isRecord(eventOrCode)) {
      closeEvent = {
        code: typeof eventOrCode.code === 'number' ? eventOrCode.code : 0,
        reason:
          typeof eventOrCode.reason === 'string' ? eventOrCode.reason : '',
        wasClean:
          typeof eventOrCode.wasClean === 'boolean'
            ? eventOrCode.wasClean
            : false,
        event: eventOrCode,
      };
    } else {
      const reason =
        typeof reasonValue === 'string'
          ? reasonValue
          : reasonValue && typeof reasonValue.toString === 'function'
            ? reasonValue.toString()
            : '';
      closeEvent = {
        code: typeof eventOrCode === 'number' ? eventOrCode : 0,
        reason,
        wasClean: false,
        event: eventOrCode,
      };
    }

    // 如果存在连接等待，则拒绝连接等待
    if (this.activeConnect) {
      this.rejectActiveConnect(
        createNamedError('socket-connect-closed', '连接完成前已关闭'),
      );
    }

    // 设置状态为已断开
    this.setState(DGLAB_SOCKET_STATE.Disconnected);

    // 分离监听
    this.detachListeners();

    // 派发关闭事件
    this.onSocketClosed(closeEvent);

    // 派发关闭事件
    this.dispatch('close', closeEvent);
  }

  /**
   * 处理 WebSocket 错误事件
   * @param error 错误
   */
  handleSocketError(error: unknown): void {
    // 直接派发错误事件
    this.dispatch('error', error);
  }

  /**
   * 创建 WebSocket 实例
   * @return WebSocket 实例
   */
  protected openSocket(): DglabWebSocketLike {
    // 如果存在 SOCKET 实例，则返回
    if (
      this.socket &&
      (this.socket.readyState === 0 || this.socket.readyState === 1)
    ) {
      return this.socket;
    }

    // 如果无 URL，则视为手动传输模式，不主动创建 WebSocket 连接
    if (!this.options.url) {
      this.socket = {
        readyState: 1,
        send: (data) => {
          if (this.manualSender) {
            this.manualSender(data);
            return;
          }
          throw createNamedError('socket-send', '手动模式未绑定发送函数');
        },
        close: () => undefined,
      };
      return this.socket;
    }

    // 有 URL 时默认使用 ws 创建并管理连接
    const socket = new WsWebSocket(
      this.options.url,
      this.options.protocols,
    ) as unknown as DglabWebSocketLike;

    // 附加内部 WebSocket
    this.attachInternalSocket(socket);

    // 返回 WebSocket 实例
    return socket;
  }

  /**
   * 设置 SOCKET 状态
   * @param state 状态
   */
  protected setState(state: DGLAB_SOCKET_STATE): void {
    if (state === this.currentState) return;

    // 状态只在变化时派发，避免重复事件干扰
    const previous = this.currentState;
    this.currentState = state;

    // 派发状态事件
    this.dispatch('state', state, previous);
  }

  /**
   * 获取连接超时时间
   * @return 连接超时时间
   */
  protected connectTimeout(): number {
    return this.options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
  }

  /**
   * 派发事件
   * @param event 事件
   * @param args 事件参数
   * @return 是否派发成功
   */
  protected dispatch<K extends keyof DglabSocketEventMap>(
    event: K,
    ...args: Parameters<DglabSocketEventMap[K]>
  ): boolean {
    const emit = this.emit.bind(this) as DglabSocketEmit;
    return emit(event, ...args);
  }

  /**
   * 解决连接等待
   * @param result 连接结果
   */
  protected resolveActiveConnect(result: DglabSocketConnectResult): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
    this.activeConnect?.resolve(result);
    this.activeConnect = undefined;
  }

  /**
   * 拒绝连接等待
   * @param error 错误
   */
  protected rejectActiveConnect(error: Error): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
    this.activeConnect?.reject(error);
    this.activeConnect = undefined;
  }

  /**
   * 处理 SOCKET 关闭事件
   * @param _event 事件
   */
  protected onSocketClosed(_event: DglabSocketCloseEvent): void {}

  /**
   * 处理协议消息
   * @param text 文本消息
   * @param raw 原始消息
   */
  protected abstract handleProtocolMessage(
    text: string,
    raw: DglabSocketIncoming,
  ): void;

  /**
   * 附加内部 WebSocket
   * @param socket WebSocket 实例
   */
  private attachInternalSocket(socket: DglabWebSocketLike): void {
    // 重新 attach 或 disconnect 时清理旧监听，单实例只维护一个连接
    this.detachListeners();

    // 设置 SOCKET 实例
    this.socket = socket;

    // 监听 WebSocket 事件
    this.cleanups = [
      this.listenSocket(socket, 'open', (event) =>
        this.handleSocketOpen(event),
      ),
      this.listenSocket(socket, 'message', (...args) => {
        const [first] = args;
        const data =
          isRecord(first) && 'data' in first
            ? (first.data as DglabSocketIncoming)
            : (first as DglabSocketIncoming);
        this.handleSocketMessage(data);
      }),
      this.listenSocket(socket, 'close', (...args) =>
        this.handleSocketClose(...args),
      ),
      this.listenSocket(socket, 'error', (error) =>
        this.handleSocketError(error),
      ),
    ];
  }

  /**
   * 分离监听
   */
  private detachListeners(): void {
    // 重新 attach 或 disconnect 时清理旧监听，单实例只维护一个连接
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }

  /**
   * 监听 WebSocket
   * @param socket WebSocket 实例
   * @param eventName 事件名称
   * @param listener 事件监听器
   * @return 监听器清理函数
   */
  private listenSocket(
    socket: DglabWebSocketLike,
    eventName: 'open' | 'message' | 'close' | 'error',
    listener: (...args: unknown[]) => void,
  ): DglabSocketListenerCleanup {
    // 使用 addEventListener 优先，避免重复监听
    if (typeof socket.addEventListener === 'function') {
      const handler = (event: unknown) => listener(event);
      socket.addEventListener(eventName, handler);
      return () => socket.removeEventListener?.(eventName, handler);
    }

    // 其次使用 on 监听
    if (typeof socket.on === 'function') {
      socket.on(eventName, listener);
      return () => {
        if (typeof socket.off === 'function') {
          socket.off(eventName, listener);
          return;
        }
        socket.removeListener?.(eventName, listener);
      };
    }

    // 组合 KEY
    const key = `on${eventName}` as keyof DglabWebSocketLike;
    // 获取旧监听
    const previous = socket[key] as ((...args: unknown[]) => void) | undefined;
    // 创建新监听
    const handler = (...args: unknown[]) => {
      previous?.(...args);
      listener(...args);
    };
    Object.assign(socket, { [key]: handler });

    // CLEAN UP
    return () => {
      // 如果新监听与旧监听相同，则恢复旧监听
      if (socket[key] === handler) Object.assign(socket, { [key]: previous });
    };
  }
}
