import { useEffect, useRef, useState } from "react";
import { Button } from "@t00ls-dev/ui/components/button";
import { Input } from "@t00ls-dev/ui/components/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@t00ls-dev/ui/components/collapsible";

export function AuthenticatorKey({ secret }: { secret: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost">Can't scan? Use setup key</Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {open ? <RevealedKey secret={secret} /> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function RevealedKey({ secret }: { secret: string }) {
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const live = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function copy() {
    if (pending) return;
    setPending(true);
    setFeedback("");
    try {
      await navigator.clipboard.writeText(secret);
      if (live.current) setFeedback("Copied");
    } catch {
      if (live.current) {
        setFeedback(
          "Couldn't copy. Select the setup key and copy it manually.",
        );
        input.current?.focus();
        input.current?.select();
      }
    } finally {
      if (live.current) setPending(false);
    }
  }
  return (
    <div className="grid gap-3 py-3">
      <label>
        Setup key
        <Input
          ref={input}
          className="font-mono"
          readOnly
          autoComplete="off"
          value={secret}
          aria-label="Setup key"
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => void copy()}
      >
        Copy
      </Button>
      <p role="status" className="m-0 min-h-6 text-sm">
        {feedback}
      </p>
    </div>
  );
}
