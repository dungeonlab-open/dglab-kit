import { isRecord } from '@/shared';
import type {
  V4DeviceDescriptor,
  V4DeviceInfo,
  V4EventPayload,
  V4RpcResponse,
  V4SlotPatch,
} from './types';

export class V4Client {
  readonly clientId: string;
  public devices: V4DeviceInfo[];

  constructor(clientId: string, devices: V4DeviceInfo[] = []) {
    this.clientId = clientId;
    this.devices = devices;
  }

  /**
   * 获取设备
   * @param slotId 设备 ID
   */
  getDevice(slotId: string): V4DeviceInfo | undefined {
    return this.devices.find((device) => device.slotId === slotId);
  }

  /**
   * 分发被控方上行数据并同步设备列表
   * @param data 上行数据
   * @return 是否产生设备列表变更
   */
  dispatch(data: unknown): boolean {
    if (this.updateDevicesFromEvent(data)) return true;
    if (!V4Client.isRpcResponse(data)) return false;
    return this.updateDevicesFromResponse(data.result);
  }

  /**
   * 替换全部设备
   * @param devices 设备列表
   */
  replaceDevices(devices: (V4DeviceDescriptor | V4DeviceInfo)[]): void {
    this.devices.splice(0, this.devices.length, ...devices);
  }

  /**
   * 新增或替换设备
   * @param device 设备信息
   */
  upsertDevice(device: V4DeviceInfo): void {
    const index = this.findDeviceIndex(device.slotId);
    if (index === -1) {
      this.devices.push(device);
      return;
    }
    this.devices[index] = device;
  }

  /**
   * 移除设备
   * @param slotId 设备 ID
   */
  removeDevice(slotId: string): void {
    const index = this.findDeviceIndex(slotId);
    if (index === -1) return;
    this.devices.splice(index, 1);
  }

  /**
   * 增量更新设备列表
   * @param added 新增或替换的设备
   * @param removed 移除的设备 ID
   */
  patchDevices(added: V4DeviceInfo[], removed: string[]): void {
    for (const device of added) {
      this.upsertDevice(device);
    }
    for (const slotId of removed) {
      this.removeDevice(slotId);
    }
  }

  /**
   * 增量更新插槽状态
   * @param slots 插槽增量列表
   */
  patchSlots(slots: V4SlotPatch[]): void {
    for (const slot of slots) {
      const index = this.findDeviceIndex(slot.slotId);
      if (index === -1) continue;

      const current = this.devices[index];
      this.devices[index] = {
        ...current,
        props: { ...(current.props ?? {}), ...(slot.props ?? {}) },
        slotState: {
          ...(current.slotState ?? {}),
          ...(slot.slotState ?? {}),
        },
      };
    }
  }

  /**
   * 销毁连接状态
   */
  destroy(): void {
    this.devices.splice(0, this.devices.length);
  }

  private updateDevicesFromEvent(data: unknown): boolean {
    if (!V4Client.isEventPayload(data)) return false;

    if (data.ev === 'devices.snapshot') {
      this.replaceDevices(data.devices);
      return true;
    }

    if (data.ev === 'devices.patch') {
      this.patchDevices(data.added ?? [], data.removed ?? []);
      return true;
    }

    if (data.ev === 'slots.patch') {
      this.patchSlots(data.slots ?? []);
      return true;
    }

    return false;
  }

  private updateDevicesFromResponse(result: unknown): boolean {
    if (!V4Client.hasDevicesResult(result)) return false;
    this.replaceDevices(result.devices);
    return true;
  }

  private findDeviceIndex(slotId: string): number {
    return this.devices.findIndex((device) => device.slotId === slotId);
  }

  private static isRpcResponse(data: unknown): data is V4RpcResponse {
    return isRecord(data) && data.t === 'resp';
  }

  private static isEventPayload(data: unknown): data is V4EventPayload {
    return isRecord(data) && data.t === 'ev' && typeof data.ev === 'string';
  }

  private static hasDevicesResult(
    result: unknown,
  ): result is { devices: (V4DeviceDescriptor | V4DeviceInfo)[] } {
    return isRecord(result) && Array.isArray(result.devices);
  }
}
