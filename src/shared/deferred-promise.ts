export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export interface PendingValue<T> {
  settled: boolean;
  value?: T;
  error?: unknown;
  waiters: Set<Deferred<T>>;
  timer?: ReturnType<typeof setTimeout>;
}

// 创建可手动完成的 Promise
export const createDeferredPromise = <T>(): Deferred<T> => {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
};
