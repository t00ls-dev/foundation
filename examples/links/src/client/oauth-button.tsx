import type { ReactNode } from "react";

export type OAuthProviderPresentation = {
  label: string;
  icon: ReactNode;
  className: string;
};

// Presentation only: callers own capability, initiation, errors and lifecycle.
export function OAuthButton({
  provider,
  pending,
  onClick,
  describedBy,
}: {
  provider: OAuthProviderPresentation;
  pending: boolean;
  onClick: () => void;
  describedBy?: string | undefined;
}) {
  return (
    <button
      type="button"
      className={`oauth-button ${provider.className}`}
      disabled={pending}
      aria-busy={pending}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      <span className="oauth-button-icon" aria-hidden="true">
        {pending ? <span className="oauth-spinner" /> : provider.icon}
      </span>
      <span>{provider.label}</span>
    </button>
  );
}
