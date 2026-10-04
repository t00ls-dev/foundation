import type { ComponentProps, ReactNode } from "react";
import { Button } from "../components/ui/button.js";
import { Spinner } from "../components/ui/spinner.js";

export function PendingButton({
  pending,
  pendingLabel,
  children,
  disabled,
  ...props
}: ComponentProps<typeof Button> & {
  pending: boolean;
  pendingLabel: ReactNode;
}) {
  return (
    <Button {...props} disabled={disabled || pending} aria-busy={pending}>
      {pending ? <Spinner /> : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}
