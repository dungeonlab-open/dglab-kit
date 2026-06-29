import type {
  V3DeviceEventPayload,
  V3DeviceInfo,
  V4DeviceEventPayload,
  V4DeviceInfo,
} from '@/socket';

export type DglabSocketDeviceEventPayload = {
  removed?: true;
} & (V3DeviceEventPayload | V4DeviceEventPayload);

export type DglabSocketDeviceInfo = V3DeviceInfo | V4DeviceInfo;

/**
 * DG-LAB APP 支持的协议
 */
export enum DGLAB_SOCKET_VERSION {
  /**
   * @deprecated 请使用 V4 协议
   */
  V3 = 'v3',
  V4 = 'v4',
}

/**
 * SOCKET 状态
 * - Idle: 未连接
 * - Connecting: 正在连接
 * - WaitingForPeer: 等待控制端接入
 * - Paired: 已连接
 * - Disconnected: 连接断开
 */
export enum DGLAB_SOCKET_STATE {
  Idle = 'idle',
  Connecting = 'connecting',
  WaitingForPeer = 'waiting_for_peer',
  Paired = 'paired',
  Disconnected = 'disconnected',
}

/**
 * SOCKET 支持的数据类型
 */
export type DglabSocketIncoming =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | { toString(): string }
  | undefined;

/**
 * SOCKET 支持的发送数据类型
 */
export type DglabSocketOutgoing = string | ArrayBuffer | ArrayBufferView;

/**
 * SOCKET 监听清理函数
 */
export type DglabSocketListenerCleanup = () => void;

/**
 * SOCKET 兼容 WebSocket 接口
 */
export interface DglabWebSocketLike {
  readonly readyState?: number;
  send: (data: DglabSocketOutgoing) => unknown;
  close: (code?: number, reason?: string) => unknown;
  addEventListener?: (
    event: 'open' | 'message' | 'close' | 'error',
    listener: (...args: unknown[]) => void,
  ) => unknown;
  removeEventListener?: (
    event: 'open' | 'message' | 'close' | 'error',
    listener: (...args: unknown[]) => void,
  ) => unknown;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => unknown;
  onopen?: ((...args: unknown[]) => void) | null;
  onmessage?: ((...args: unknown[]) => void) | null;
  onclose?: ((...args: unknown[]) => void) | null;
  onerror?: ((...args: unknown[]) => void) | null;
}

/**
 * 自定义 WebSocket 消息发送
 */
export type DglabSocketSender = (data: DglabSocketOutgoing) => void;

/**
 * SOCKET 共享选项
 */
export interface DglabSocketSharedOptions {
  url?: string;
  protocols?: string | string[];
  connectTimeout?: number;
  responseTimeout?: number;
}

/**
 * V3 协议选项
 * @deprecated 请使用 V4 协议
 */
export interface DglabSocketV3Options extends DglabSocketSharedOptions {
  version: DGLAB_SOCKET_VERSION.V3;
}

/**
 * V4 协议选项
 */
export interface DglabSocketV4Options extends DglabSocketSharedOptions {
  version?: DGLAB_SOCKET_VERSION.V4;
}

/**
 * SOCKET 选项
 */
export type DglabSocketOptions = DglabSocketV3Options | DglabSocketV4Options;

/**
 * SOCKET 连接结果
 * targetId: 被控端 ID
 * secret: HTTP 密钥（仅 V4 用于 HTTP 鉴权）
 */
export interface DglabSocketConnectResult {
  targetId: string;
  secret?: string;
}

/**
 * SOCKET 关闭事件
 */
export interface DglabSocketCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
  event?: unknown;
}

/**
 * SOCKET 发送选项
 */
export interface DglabSendOptions {
  timeout?: number;
}

/**
 * SOCKET 事件映射
 */
export interface DglabSocketEventMap {
  message: (data: string, raw: DglabSocketIncoming) => void;
  state: (state: DGLAB_SOCKET_STATE, previous: DGLAB_SOCKET_STATE) => void;
  open: (event?: unknown) => void;
  close: (event: DglabSocketCloseEvent) => void;
  error: (error: unknown) => void;
  frame: (frame: unknown) => void;
  data: (data: unknown, clientId?: string) => void;
  action: (action: number) => void;
  device: (event: DglabSocketDeviceEventPayload, clientId: string) => void;
  devices: (devices: DglabSocketDeviceInfo[], clientId: string) => void;
  'client-attached': (clientId: string) => void;
  'client-disconnected': (clientId: string) => void;
}

export enum DglabSocketDeviceType {
  COYOTE_020 = 'COYOTE_020', // 郊狼 2.0
  COYOTE_030 = 'COYOTE_030', // 郊狼 3.0
  BMTR_1 = 'BMTR_1', // 灵猫 1.0
  OVC_1 = 'OVC_1', // 负鼠 1.0
}
