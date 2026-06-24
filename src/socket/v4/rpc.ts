import { createNamedError, isRecord } from '@/shared';
import type {
  V4AnyRpcPayload,
  V4DeviceOperate,
  V4OperateOptions,
  V4PendingResponse,
  V4RpcMethod,
  V4RpcRequest,
  V4RpcResponse,
  V4SendOptions,
  V4SendPromise,
} from './types';

const DEFAULT_RESPONSE_TIMEOUT = 8_000;

interface V4RpcOptions {
  responseTimeout?: number;
}

export class V4Rpc {
  private readonly pending = new Map<string, V4PendingResponse>();
  private readonly sendFrame: (frame: unknown) => void;
  private readonly options: V4RpcOptions;

  constructor(sendFrame: (frame: unknown) => void, options: V4RpcOptions = {}) {
    this.sendFrame = sendFrame;
    this.options = options;
  }

  /**
   * 创建 V4 RPC 请求
   * @param method RPC 方法名
   * @param data 请求数据
   */
  createRequest<TData>(
    method: V4RpcMethod | (string & {}),
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
   * 发送协议数据
   * @param data 数据
   * @param options 选项
   */
  send<TData = unknown, TResponse = unknown>(
    data: TData,
    options?: V4SendOptions,
  ): V4SendPromise<TResponse> {
    const clientId = options?.clientId;
    if (!clientId) {
      throw createNamedError(
        'socket-clientId',
        '发送协议数据需要指定 clientId',
      );
    }

    let requestId: string | undefined;

    try {
      const existingRequestId = V4Rpc.getRequestId(data);
      requestId = existingRequestId ?? this.createRequestId();
      let payload: V4AnyRpcPayload;

      if (isRecord(data)) {
        payload = { ...data, requestId, reqId: requestId } as V4AnyRpcPayload;
      } else {
        payload = {
          t: 'req',
          requestId,
          reqId: requestId,
          m: 'custom',
          data,
        };
      }

      const waitableRequestId = V4Rpc.getRequestId(payload);
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
        }, this.responseTimeout(options));

        entry = pending;
        this.pending.set(key, pending as V4PendingResponse);
      }

      let error: unknown =
        waitableRequestId === undefined
          ? createNamedError('socket-command', '当前消息没有可等待响应')
          : undefined;

      try {
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
   * 发送 device.op 指令
   * @param data 指令数据
   * @param options 选项
   */
  sendOperate(
    data: V4DeviceOperate,
    options?: V4OperateOptions,
  ): V4SendPromise {
    return this.send(this.createRequest('device.op', data), {
      clientId: options?.clientId,
      timeout: options?.timeout,
    });
  }

  /**
   * 处理 RPC 响应
   * @param clientId 被控方 ID
   * @param response 响应数据
   */
  resolveResponse(clientId: string, response: V4RpcResponse): void {
    const requestId = V4Rpc.getRequestId(response);
    if (!requestId) return;

    const key = this.pendingKey(clientId, requestId);
    const entry = this.pending.get(key);
    if (!entry) return;

    this.pending.delete(key);

    if (response.error) {
      this.rejectPending(
        entry,
        createNamedError(
          'socket-v4-response',
          response.error ?? 'V4 指令执行失败',
        ),
      );
      return;
    }

    if (entry.settled) return;
    entry.settled = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(response.result);
  }

  /**
   * 拒绝指定被控方的所有待完成指令
   * @param clientId 被控方 ID
   */
  rejectClientPending(clientId: string): void {
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
   */
  rejectAllPending(error: Error): void {
    for (const [, entry] of this.pending) {
      this.rejectPending(entry, error);
    }
    this.pending.clear();
  }

  /**
   * 判断是否为 V4 RPC 响应帧
   * @param data 帧数据
   */
  static isResponse(data: unknown): data is V4RpcResponse {
    return isRecord(data) && data.t === 'resp';
  }

  /**
   * 获取 V4 请求 ID
   * @param data 帧数据
   */
  static getRequestId(data: unknown): string | undefined {
    if (!isRecord(data)) return undefined;
    if (typeof data.requestId === 'string') return data.requestId;
    if (typeof data.reqId === 'string') return data.reqId;
    return undefined;
  }

  private createRequestId(): string {
    return `v4-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  private responseTimeout(options?: V4SendOptions): number {
    return (
      options?.timeout ??
      this.options.responseTimeout ??
      DEFAULT_RESPONSE_TIMEOUT
    );
  }

  private pendingKey(clientId: string, requestId: string): string {
    return `${clientId}\u0000${requestId}`;
  }

  private rejectPending<T>(entry: V4PendingResponse<T>, error: unknown): void {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.reject(error);
  }
}
