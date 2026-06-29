import type { DglabSocketDeviceType } from '@/socket/base/types';

/**
 * V4 协议帧类型
 */
export type V4ServerFrame<TData = unknown> =
  | V4HelloFrame
  | V4ClientAttachedFrame
  | V4ClientDisconnectedFrame
  | V4HeartbeatFrame
  | V4IdleTimeoutFrame
  | V4ErrorFrame
  | V4MessageFrame<TData>;

/**
 * V4 Hello 帧
 */
export interface V4HelloFrame {
  type: 'hello';
  clientId: string; // 被控方 ID
  secret?: string; // HTTP 鉴权密钥
}

/**
 * V4 客户端接入帧
 */
export interface V4ClientAttachedFrame {
  type: 'client_attached';
  clientId: string; // 被控方 ID
}

/**
 * V4 客户端断开帧
 */
export interface V4ClientDisconnectedFrame {
  type: 'client_disconnected';
  clientId: string; // 被控方 ID
}

/**
 * V4 心跳帧（控制方无需回复）
 */
export interface V4HeartbeatFrame {
  type: 'heartbeat';
}

/**
 * V4 空闲超时帧（控制方空闲超时，随后连接会被服务端关闭）
 */
export interface V4IdleTimeoutFrame {
  type: 'idle_timeout';
}

/**
 * V4 错误帧
 */
export interface V4ErrorFrame {
  type: 'error';
  code: string; // 业务错误码
  message?: string; // 可选错误描述
  clientId?: string; // 错误关联的被控方 ID
}

/**
 * V4 消息帧
 */
export interface V4MessageFrame<TData = unknown> {
  type: 'message';
  clientId: string; // 控制方发送时表示目标，被控方上报时表示来源
  data: TData; // 应用层负载
}

/**
 * V4 RPC 方法名
 */
export type V4RpcMethod = 'devices.get' | 'device.op' | 'device.op.clear';

/**
 * V4 动作类型
 * - AppendPulseData: 裸波形数据任务
 * - AddIntensity: 相对增减强度任务
 * - SetTempIntensity: 设置临时强度任务
 * - SetIntensity: 设置绝对强度任务
 */
export enum V4ActionType {
  AppendPulseData = 0,
  AddIntensity = 3,
  SetTempIntensity = 4,
  SetIntensity = 7,
}

/**
 * V4 通道类型
 * - A: A 通道
 * - B: B 通道
 */
export enum V4Channel {
  A = 0,
  B = 1,
}

/**
 * V4 RPC 请求
 */
export interface V4RpcRequest<TData = unknown> {
  t: 'req'; // 请求类型标记
  reqId?: string; // 推荐字段名，参考文档使用 reqId
  requestId?: string; // 测试服务兼容字段，服务端等待逻辑识别 requestId
  m?: V4RpcMethod | (string & {}); // 远端方法名
  data?: TData; // 指令参数
}

/**
 * V4 RPC 响应
 */
export interface V4RpcResponse<TResult = unknown> {
  t: 'resp'; // 响应类型标记
  reqId?: string; // 推荐响应 ID
  requestId?: string; // 测试服务兼容响应 ID
  result?: TResult; // 成功结果
  error?: string; // 失败错误码
}

/**
 * V4 设备描述
 */
export interface V4DeviceDescriptor {
  slotId: string; // 真实 slotId，设备指令使用它定位设备
  name: string; // 设备展示名
  type: DglabSocketDeviceType; // 设备类型
}

/**
 * V4 插槽状态
 */
export interface V4SlotState {
  markLight: 'yellow' | 'green' | 'red' | 'purple' | 'blue' | 'cyan' | null; // 插槽标记灯颜色，无颜色时为 null
  hasDevice: boolean; // 当前插槽是否有真实设备连接
  [key: string]: unknown; // 允许被控方携带未来扩展状态
}

/**
 * V4 设备信息
 */
export interface V4DeviceInfo extends V4DeviceDescriptor {
  props?: Record<string, unknown>; // 当前设备属性快照
  slotState?: Partial<V4SlotState> & Record<string, unknown>; // 当前插槽状态快照
}

/**
 * V4 设备列表获取结果
 */
export interface V4DevicesGetResult {
  devices: V4DeviceDescriptor[]; // 被控方当前暴露的设备描述列表
}

/**
 * V4 设备快照事件
 */
export interface V4DevicesSnapshotEvent {
  t: 'ev'; // 事件类型标记
  ev: 'devices.snapshot'; // 被控方连接后上报全量设备列表
  devices: V4DeviceInfo[]; // 当前全部设备完整信息
}

/**
 * V4 设备列表增量事件
 */
export interface V4DevicesPatchEvent {
  t: 'ev'; // 事件类型标记
  ev: 'devices.patch'; // 被控方设备列表增量
  added?: V4DeviceInfo[]; // 新增设备完整信息
  removed?: string[]; // 移除设备 slotId
}

/**
 * V4 插槽增量事件
 */
export interface V4SlotPatch {
  slotId: string; // 被更新设备 slotId
  props?: Record<string, unknown>; // 设备属性增量
  slotState?: Partial<V4SlotState> & Record<string, unknown>; // 插槽状态增量
}

/**
 * V4 插槽增量事件
 */
export interface V4SlotsPatchEvent {
  t: 'ev'; // 事件类型标记
  ev: 'slots.patch'; // 插槽状态或属性增量
  slots?: V4SlotPatch[]; // 插槽增量列表
}

/**
 * V4 自定义动作事件
 */
export interface V4CustomActionEvent {
  t: 'ev'; // 事件类型标记
  ev: 'custom.action'; // 被控方自定义动作
  action: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; // 动作编号
}

/**
 * V4 事件联合类型
 */
export type V4EventPayload =
  | V4DevicesSnapshotEvent
  | V4DevicesPatchEvent
  | V4SlotsPatchEvent
  | V4CustomActionEvent;

/**
 * V4 设备事件
 */
export type V4DeviceEventPayload =
  | V4DeviceInfo
  | (Partial<V4DeviceInfo> & { slotId: string; removed?: true });

/**
 * V4 发送选项
 */
export interface V4SendOptions {
  timeout?: number; // 指令等待超时时间
}

/**
 * V4 设备操作基础类型
 */
export interface V4DeviceOperateBase {
  s: string; // 目标设备 slotId
  c: V4Channel; // 目标通道
  p?: 0 | 1 | 2; // 优先级
  d?: number; // 持续时间，单位 ms
  im?: boolean; // 是否替换同类任务
}

/**
 * V4 相对强度指令
 */
export interface V4AddIntensityOperate extends V4DeviceOperateBase {
  t: V4ActionType.AddIntensity;
  v: number; // 强度变化量
}

/**
 * V4 临时强度任务
 */
export interface V4SetTempIntensityOperate extends V4DeviceOperateBase {
  t: V4ActionType.SetTempIntensity;
  v: number; // 临时强度值
}

/**
 * V4 绝对强度指令
 */
export interface V4SetIntensityOperate extends V4DeviceOperateBase {
  t: V4ActionType.SetIntensity;
  v: number; // 目标强度值
}

/**
 * V4 波形数据指令
 */
export interface V4AppendPulseDataOperate extends V4DeviceOperateBase {
  t: V4ActionType.AppendPulseData;
  v: number[][] | string[]; // 波形数据帧
  ver?: number; // 波形数据版本
  seq?: number; // 兼容旧协议序号
}

/**
 * V4 波形数据选项
 */
export interface V4AppendPulseDataOptions
  extends Omit<V4OperateOptions, 'duration'> {
  version?: number; // 波形数据版本，2 表示 V2 帧，省略或 3 表示 V3 帧
  seq?: number; // 兼容旧协议的帧序列号
}

/**
 * V4 设备操作联合类型
 */
export type V4DeviceOperate =
  | V4AddIntensityOperate
  | V4SetTempIntensityOperate
  | V4SetIntensityOperate
  | V4AppendPulseDataOperate;

/**
 * V4 操作选项
 */
export interface V4OperateOptions extends V4SendOptions {
  priority?: 0 | 1 | 2; // 任务优先级
  immediate?: boolean; // 是否替换同类任务
}

/**
 * V4 清理操作选项
 */
export type V4ClearOperateOptions =
  | { slotId?: undefined; channel?: undefined }
  | { slotId: string; channel?: V4Channel };

/**
 * V4 发送 Promise
 */
export type V4SendPromise<TResponse = unknown> = Promise<TResponse> & {
  requestId?: string; // 实际发送给被控方的请求 ID
  clientId?: string; // 实际目标被控方 clientId
};

/**
 * V4 任意 RPC 负载联合类型
 */
export type V4AnyRpcPayload =
  | V4RpcRequest
  | V4RpcResponse
  | Record<string, unknown>;

/**
 * V4 等待响应
 */
export interface V4PendingResponse<T = unknown> {
  clientId: string; // 目标被控方 clientId
  requestId: string; // 等待响应请求 ID
  promise: Promise<T>; // 等待响应 Promise
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
  settled: boolean;
}
