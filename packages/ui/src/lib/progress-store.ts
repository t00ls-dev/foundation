/** Explicit operations only: completion, abort and unmount share idempotent cleanup. */
export function createProgressStore() {
  const operations = new Set<symbol>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    getSnapshot: () => operations.size > 0,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin(signal?: AbortSignal) {
      const operation = Symbol();
      const finish = () => {
        signal?.removeEventListener("abort", finish);
        if (operations.delete(operation)) notify();
      };
      if (!signal?.aborted) {
        operations.add(operation);
        signal?.addEventListener("abort", finish, { once: true });
        notify();
      }
      return finish;
    },
  };
}
