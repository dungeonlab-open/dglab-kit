/**
 * V3 服务端帧
 */
export type V3ServerFrame =
  | V3BindFrame
  | V3MessageFrame
  | V3BreakFrame
  | V3ErrorFrame
  | V3HeartbeatFrame;

/**
 * V3 绑定流程帧
 */
export interface V3BindFrame {
  type: 'bind';
  clientId: string; // 控制方 ID
  targetId?: string; // 被控方 ID
  message?: string; // 200 表示配对成功，400/401 表示失败
}

/**
 * V3 消息帧
 */
export interface V3MessageFrame {
  type: 'msg' | string | number;
  clientId?: string; // 控制方 ID
  targetId?: string; // 被控方 ID
  message?: string; // 消息
  channel?: number | string; // 通道
  strength?: number; // 强度
  [key: string]: unknown; // 其他兼容字段
}

/**
 * V3 断开帧
 */
export interface V3BreakFrame {
  type: 'break';
  clientId?: string; // 控制方 ID
  targetId?: string; // 被控方 ID
  message?: string; // 错误码
}

/**
 * V3 错误帧
 */
export interface V3ErrorFrame {
  type: 'error';
  message?: string; // 错误码
}

/**
 * V3 心跳帧
 */
export interface V3HeartbeatFrame {
  type: 'heartbeat';
}

/**
 * V3 旧协议命令
 */
export interface V3LegacyCommand {
  type: string | number; // 命令类型
  message: string; // 消息内容
  channel?: number | string; // 通道
  time?: number; // 持续时间
  strength?: number; // 强度
  [key: string]: unknown; // 其他兼容字段
}

/**
 * V3 通道定义
 * - 1: A
 * - 2: B
 */
export type V3Channel = 1 | 2;

export type V3WaveChannel = 'A' | 'B';

/**
 * V3 单设备信息
 */
export interface V3DeviceInfo {
  type: 'COYOTE_030'; // V3 仅支持郊狼 3.0
  props?: {
    strength?: {
      A?: number;
      B?: number;
    };
    softLimit?: {
      A?: number;
      B?: number;
    };
    [key: string]: unknown;
  };
}

/**
 * V3 单设备事件
 */
export type V3DeviceEventPayload =
  | V3DeviceInfo
  | (Partial<V3DeviceInfo> & { type: 'COYOTE_030'; removed?: true });

/**
 * V3 波形选项
 */
export interface V3WaveOptions {
  channel: V3WaveChannel; // 波形通道，A 或 B
  time: number; // 持续时间，单位秒
  data: string | string[]; // 波形帧 JSON 字符串或十六进制帧列表
}
