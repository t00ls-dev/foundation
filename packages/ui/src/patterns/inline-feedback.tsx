import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";

// Urgency is independent of visual tone. Unknown results remain contextual.
export function InlineFeedback({
  children,
  tone = "neutral",
  announce = "polite",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "error" | "success";
  announce?: "polite" | "assertive" | "off";
  className?: string;
}) {
  return (
    <p
      role={
        announce === "off"
          ? undefined
          : announce === "assertive"
            ? "alert"
            : "status"
      }
      className={cn(
        "rounded-md border border-border px-4 py-3",
        tone === "neutral" && "bg-muted text-foreground",
        tone === "error" && "bg-error-surface text-destructive",
        tone === "success" && "bg-accent text-primary",
        className,
      )}
    >
      {children}
    </p>
  );
}
