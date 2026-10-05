import { useEffect, useRef, useState } from "react";
import { Button } from "@t00ls-dev/ui/components/button";
import { Skeleton } from "@t00ls-dev/ui/components/skeleton";
import { InlineFeedback } from "@t00ls-dev/ui/patterns/inline-feedback";

type WidgetApi = {
  render: (
    container: HTMLElement,
    options: {
      "sitekey": string;
      "action": string;
      "theme": "light";
      "size": "flexible" | "compact";
      "response-field": false;
      "callback": (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "timeout-callback": () => void;
      "retry": "never";
      "refresh-expired": "manual";
      "refresh-timeout": "manual";
    },
  ) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: WidgetApi;
  }
}
const sdkUrl =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<WidgetApi> | null = null;
function loadWidget(): Promise<WidgetApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<WidgetApi>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error("Verification unavailable"));
    }, 15000);
    script.src = sdkUrl;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else {
        script.remove();
        reject(new Error("Verification unavailable"));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("Verification unavailable"));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function TurnstileWidget({
  siteKey,
  action,
  revision,
  onToken,
}: {
  siteKey: string;
  action: string;
  revision: number;
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error" | "expired">(
    "loading",
  );
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let live = true;
    let api: WidgetApi | undefined;
    let widget: string | undefined;
    onToken("");
    setState("loading");
    function clear() {
      const previous = widget;
      widget = undefined;
      if (previous !== undefined) api?.remove(previous);
      onToken("");
    }
    let size: "flexible" | "compact" =
      element.clientWidth >= 300 ? "flexible" : "compact";
    const observer = new ResizeObserver(() => {
      const next = element.clientWidth >= 300 ? "flexible" : "compact";
      if (live && next !== size) {
        size = next;
        clear();
        setAttempt((value) => value + 1);
      }
    });
    observer.observe(element);
    function restored(event: PageTransitionEvent) {
      if (event.persisted && live) {
        clear();
        setState("expired");
      }
    }
    window.addEventListener("pageshow", restored);
    void loadWidget()
      .then((loaded) => {
        if (!live) return;
        api = loaded;
        widget = api.render(element, {
          "sitekey": siteKey,
          action,
          "theme": "light",
          size,
          "response-field": false,
          "retry": "never",
          "refresh-expired": "manual",
          "refresh-timeout": "manual",
          "callback": (token) => {
            if (live && widget !== undefined) {
              onToken(token);
              setState("ready");
            }
          },
          "expired-callback": () => {
            if (live) {
              clear();
              setState("expired");
            }
          },
          "timeout-callback": () => {
            if (live) {
              clear();
              setState("expired");
            }
          },
          "error-callback": () => {
            if (live) {
              clear();
              setState("error");
            }
          },
        });
        setState("ready");
      })
      .catch(() => {
        if (live) {
          onToken("");
          setState("error");
        }
      });
    return () => {
      live = false;
      clear();
      observer.disconnect();
      window.removeEventListener("pageshow", restored);
    };
  }, [siteKey, action, revision, attempt, onToken]);
  return (
    <div
      className="turnstile-verification"
      aria-label="Verification"
      aria-busy={state === "loading"}
    >
      <div ref={container} className="turnstile-container" />
      {state === "loading" ? (
        <Skeleton className="pointer-events-none absolute top-0 h-16 w-40 max-w-full" />
      ) : null}
      {state === "error" || state === "expired" ? (
        <>
          <InlineFeedback tone="error" announce="assertive">
            {state === "expired"
              ? "Verification expired. Please try again."
              : "Could not load verification. Please try again."}
          </InlineFeedback>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry verification
          </Button>
        </>
      ) : null}
    </div>
  );
}
