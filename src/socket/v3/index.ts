import { createNamedError } from '@/shared';
import {
  DGLAB_SOCKET_STATE,
  DglabSocketDeviceType,
  type DglabSocketConnectResult,
  type DglabSocketIncoming,
} from '@/socket/base/types';
import { DglabSocketBase } from '@/socket/base';
import type {
  V3Channel,
  V3DeviceEventPayload,
  V3DeviceInfo,
  V3LegacyCommand,
  V3ServerFrame,
  V3WaveOptions,
} from './types';

export class DglabSocketV3 extends DglabSocketBase {
  private _targetId?: string; // 被控端 ID
  private pairedTargetId?: string; // 已配对被控端 ID
  private device?: V3DeviceInfo; // V3 单设备快照

  /**
   * 获取当前控制方 clientId
   * @return string | undefined
   */
  get targetId(): string | undefined {
    return this._targetId;
  }

  /**
   * 获取已配对被控端 clientId
   * @return string | undefined
   */
  get pairedClientId(): string | undefined {
    return this.pairedTargetId;
  }

  /**
   * 发送协议数据
   * @param data 数据
   * @return void
   */
  send<TData = unknown>(data: TData): void {
    if (!this._targetId || !this.pairedTargetId) {
      throw createNamedError('socket-target', 'V3 尚未完成配对');
    }

    this.sendFrame({
      ...data,
      clientId: this._targetId,
      targetId: this.pairedTargetId,
    } as unknown as V3LegacyCommand);
  }

  /**
   * 增加/减少通道强度
   * @param channel 通道 - 1: A, 2: B
   * @param step 步长
   * @return void
   */
  addStrength(channel: V3Channel, step = 1): void {
    // 旧协议 type 1/2 表示减少或增加 1，这里按步长拆成多条发送
    const type = step >= 0 ? 2 : 1;
    const count = Math.max(1, Math.abs(step));

    if (count > 200) {
      throw createNamedError('socket-v3', '单次调整强度过大');
    }

    for (let index = 0; index < count; index += 1) {
      this.send({
        type,
        channel,
        message: 'set channel',
      });
    }
  }

  /**
   * 减少通道强度
   * @param channel 通道 - 1: A, 2: B
   * @param step 步长
   * @return void
   * */
  reduceStrength(channel: V3Channel, step = 1): void {
    this.addStrength(channel, -step);
  }

  /**
   * 设置通道强度
   * @param channel 通道 - 1: A, 2: B
   * @param strength 强度
   * @return void
   */
  setStrength(channel: V3Channel, strength: number): void {
    // 旧协议 type 3 表示把通道强度设置到指定值
    this.send({
      type: 3,
      channel,
      strength,
      message: 'set channel',
    });
  }

  /**
   * 清空通道波形
   * @param channel 通道 - 1: A, 2: B
   * @return void
   */
  clearPulse(channel: V3Channel): void {
    // 旧协议 type 4 直接透传清理指令
    this.send({
      type: 4,
      message: `clear-${channel}`,
    });
  }

  /**
   * 发送波形
   * @param options 波形选项
   * @return void
   */
  sendPulse(options: V3WaveOptions): void {
    // 旧协议用 clientMsg 下发波形，服务端会补 pulse 前缀
    const payload = Array.isArray(options.data)
      ? JSON.stringify(options.data)
      : options.data;

    this.send({
      type: 'clientMsg',
      channel: options.channel,
      time: options.time,
      message: `${options.channel}:${payload}`,
    });
  }

  /**
   * 处理协议消息
   * @param text 文本
   * @param _raw 原始数据
   * @return void
   */
  protected handleProtocolMessage(
    text: string,
    _raw: DglabSocketIncoming,
  ): void {
    let frame: V3ServerFrame;

    // 尝试解析为 JSON
    try {
      frame = JSON.parse(text) as V3ServerFrame;
    } catch {
      this.dispatch('data', text);
      return;
    }

    this.dispatch('frame', frame);

    switch (frame.type) {
      case 'bind': {
        if (typeof frame.clientId !== 'string') break;

        // 初始 bind 帧给控制方分配 clientId
        if (!('targetId' in frame) || frame.targetId === '') {
          this.handleInitialBind(frame.clientId);
          return;
        }

        // message 200 的 bind 帧表示 App 已完成配对
        if (typeof frame.targetId === 'string' && frame.message === '200') {
          this.handlePairBind(frame.targetId);
          return;
        }
        break;
      }
      case 'break':
        // 对端断开后回到等待配对状态
        this.pairedTargetId = undefined;
        this.device = undefined;
        this.setState(DGLAB_SOCKET_STATE.WaitingForPeer);
        if (typeof frame.targetId === 'string') {
          this.dispatchDevice(
            { type: DglabSocketDeviceType.COYOTE_030, removed: true },
            frame.targetId,
          );
          this.dispatch('client-disconnected', frame.targetId);
        }
        return;
      case 'msg':
        this.handleForwardMessage(frame);
        return;
      case 'error':
        // 处理错误帧
        this.handleSocketError(
          createNamedError(
            'socket-v3-server',
            typeof frame.message === 'string' ? frame.message : 'V3 服务端错误',
          ),
        );
        return;
    }

    // msg 和兜底帧来自被控方或服务端，只能作为上行数据透出
    this.dispatch(
      'data',
      'message' in frame ? frame.message : frame,
      'targetId' in frame && typeof frame.targetId === 'string'
        ? frame.targetId
        : undefined,
    );
  }

  /**
   * 处理 SOCKET 关闭
   * @return void
   */
  protected onSocketClosed(): void {
    this._targetId = undefined;
    this.pairedTargetId = undefined;
    this.device = undefined;
  }

  /**
   * 获取连接结果
   * @return DglabSocketConnectResult | undefined
   */
  protected getConnectedResult(): DglabSocketConnectResult | undefined {
    if (!this._targetId) return undefined;
    return { targetId: this._targetId };
  }

  /**
   * 处理初始绑定
   * @param clientId 客户端 ID
   * @return void
   */
  private handleInitialBind(clientId: string): void {
    // 连接阶段到这里就算完成，二维码可使用该 clientId
    this._targetId = clientId;
    this.setState(DGLAB_SOCKET_STATE.WaitingForPeer);
    this.resolveActiveConnect({ targetId: clientId });
  }

  /**
   * 处理配对绑定
   * @param targetId 被控端 ID
   * @return void
   */
  private handlePairBind(targetId: string): void {
    // V3 只维护一个被控方 targetId
    this.pairedTargetId = targetId;
    this.setState(DGLAB_SOCKET_STATE.Paired);
    this.device = this.createDevice();
    this.dispatch('client-attached', targetId);
  }

  /**
   * 处理 V3 转发消息
   * @param frame 消息帧
   */
  private handleForwardMessage(frame: V3ServerFrame): void {
    if ('message' in frame && typeof frame.message === 'string') {
      const action = this.parseActionMessage(frame.message);
      if (action !== undefined) this.dispatch('action', action);

      const device = this.parseDeviceMessage(frame.message);
      if (device) this.dispatchDevice(device);
    }

    this.dispatch(
      'data',
      'message' in frame ? frame.message : frame,
      'targetId' in frame && typeof frame.targetId === 'string'
        ? frame.targetId
        : undefined,
    );
  }

  /**
   * 解析 APP 按钮反馈消息
   * @param message 消息内容
   */
  private parseActionMessage(message: string): number | undefined {
    const match = /^feedback-(\d+)$/.exec(message);
    if (!match) return undefined;

    return Number(match[1]);
  }

  /**
   * 解析 APP 回传的设备状态消息
   * @param message 消息内容
   */
  private parseDeviceMessage(
    message: string,
  ): V3DeviceEventPayload | undefined {
    const match = /^strength-(\d+)-(\d+)-(\d+)-(\d+)$/.exec(message);
    if (!match || !this.pairedTargetId) return undefined;

    const [, aStrength, bStrength, aSoftLimit, bSoftLimit] = match;
    const nextProps: NonNullable<V3DeviceInfo['props']> = {
      strength: {
        A: Number(aStrength),
        B: Number(bStrength),
      },
      softLimit: {
        A: Number(aSoftLimit),
        B: Number(bSoftLimit),
      },
    };
    const previousProps = this.device?.props;
    const props: NonNullable<V3DeviceInfo['props']> = {};

    if (previousProps?.strength?.A !== nextProps.strength?.A) {
      props.strength = { ...(props.strength ?? {}), A: nextProps.strength?.A };
    }
    if (previousProps?.strength?.B !== nextProps.strength?.B) {
      props.strength = { ...(props.strength ?? {}), B: nextProps.strength?.B };
    }
    if (previousProps?.softLimit?.A !== nextProps.softLimit?.A) {
      props.softLimit = {
        ...(props.softLimit ?? {}),
        A: nextProps.softLimit?.A,
      };
    }
    if (previousProps?.softLimit?.B !== nextProps.softLimit?.B) {
      props.softLimit = {
        ...(props.softLimit ?? {}),
        B: nextProps.softLimit?.B,
      };
    }

    this.device = {
      ...(this.device ?? this.createDevice()),
      props: nextProps,
    };

    return Object.keys(props).length > 0
      ? { type: DglabSocketDeviceType.COYOTE_030, props }
      : undefined;
  }

  /**
   * 派发 V3 单设备事件
   * @param device 设备事件
   * @param clientId 被控端 ID
   */
  private dispatchDevice(
    device: V3DeviceEventPayload,
    clientId = this.pairedTargetId,
  ): void {
    if (!clientId) return;
    this.dispatch('device', device, clientId);
  }

  private createDevice(): V3DeviceInfo {
    return {
      type: DglabSocketDeviceType.COYOTE_030,
    };
  }
}

export * from './types';
