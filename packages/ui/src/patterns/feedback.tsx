import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Toaster, toast } from "sonner";

type ConfirmedFeedback = (operation: string, message: string) => void;
const FeedbackContext = createContext<ConfirmedFeedback | null>(null);

/** One provider/Toaster per app, keyed by its identity/security boundary. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const scope = useId();
  const live = useRef(false);
  const shown = useRef(new Set<string>());
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      for (const id of shown.current) toast.dismiss(id);
    };
  }, []);
  const success = useMemo<ConfirmedFeedback>(
    () => (operation, message) => {
      const id = `${scope}:${operation}`;
      if (!live.current || shown.current.has(id)) return;
      shown.current.add(id);
      toast.success(message, { id, toasterId: scope });
    },
    [scope],
  );
  return (
    <FeedbackContext.Provider value={success}>
      {children}
      <Toaster
        id={scope}
        theme="light"
        position="bottom-right"
        closeButton
        toastOptions={{ className: "foundation-toast" }}
      />
    </FeedbackContext.Provider>
  );
}

export function useConfirmedFeedback() {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error("FeedbackProvider is required");
  return feedback;
}
