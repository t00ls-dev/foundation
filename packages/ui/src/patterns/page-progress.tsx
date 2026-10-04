import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createProgressStore } from "../lib/progress-store.js";

const ProgressContext = createContext<ReturnType<
  typeof createProgressStore
> | null>(null);

export function PageProgressProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createProgressStore);
  return (
    <ProgressContext.Provider value={store}>
      {children}
    </ProgressContext.Provider>
  );
}

export function usePageProgress() {
  const store = useContext(ProgressContext);
  if (!store) throw new Error("PageProgressProvider is required");
  return store;
}

export function useProgressOperation(active: boolean) {
  const store = usePageProgress();
  useEffect(() => {
    if (active) return store.begin();
  }, [active, store]);
}

export function PageProgress({ label = "Loading" }: { label?: string }) {
  const store = usePageProgress();
  const active = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => false,
  );
  return active ? (
    <div
      className="foundation-page-progress"
      role="progressbar"
      aria-label={label}
    >
      <div aria-hidden="true" />
    </div>
  ) : null;
}
