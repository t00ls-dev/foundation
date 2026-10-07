import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@t00ls-dev/ui/components/input";
import { Button } from "@t00ls-dev/ui/components/button";

export function PasswordInput({
  label,
  ...props
}: ComponentProps<typeof Input> & { label: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input">
      <Input {...props} type={visible ? "text" : "password"} />
      <Button
        type="button"
        variant="ghost"
        className="px-2"
        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        {visible ? (
          <EyeOff size={18} aria-hidden="true" />
        ) : (
          <Eye size={18} aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
