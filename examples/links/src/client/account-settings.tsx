import { AccountSecurity } from "./account-security.js";
import { AccountName } from "./account-name.js";
import { AccountTotp } from "./account-totp.js";
import { useLocation } from "react-router";
import { useState } from "react";
import { SettingSection } from "@t00ls-dev/ui/patterns/settings";

export function AccountSettings({
  user,
  onSessionChanged,
  onNameChanged,
  sessionId,
  onPasswordConfirmed,
  authenticatorCompletion,
  onAuthenticatorConfirmed,
  authenticatorRecoveryObserved,
  onAuthenticatorRecoveryObserved,
}: {
  user: { id: string; name: string; email: string };
  onSessionChanged: () => Promise<void>;
  onNameChanged: () => Promise<void>;
  sessionId: string;
  onPasswordConfirmed: (identity: string) => void;
  authenticatorCompletion: boolean | null;
  onAuthenticatorConfirmed: (identity: string, enabled: boolean | null) => void;
  authenticatorRecoveryObserved: boolean;
  onAuthenticatorRecoveryObserved: () => void;
}) {
  const location = useLocation();
  const [flow, setFlow] = useState<"password" | "authenticator" | null>(null);
  return (
    <section className="container--narrow stack" aria-label="Account settings">
      <h1 className="cross-page-title">Account</h1>
      <SettingSection title="Profile">
        <AccountName user={user} onNameChanged={onNameChanged} />
      </SettingSection>
      <SettingSection title="Security">
        <AccountSecurity
          disabled={flow !== null && flow !== "password"}
          open={flow === "password"}
          onOpenChange={(open) => setFlow(open ? "password" : null)}
          user={user}
          sessionId={sessionId}
          onSessionChanged={onSessionChanged}
          onPasswordConfirmed={onPasswordConfirmed}
        />
        <AccountTotp
          disabled={flow !== null && flow !== "authenticator"}
          completion={authenticatorCompletion}
          onConfirmed={onAuthenticatorConfirmed}
          recoveryObserved={authenticatorRecoveryObserved}
          onRecoveryObserved={onAuthenticatorRecoveryObserved}
          onOpenChange={(open) => setFlow(open ? "authenticator" : null)}
          key={`${sessionId}:${location.key}`}
          user={user}
          sessionId={sessionId}
          onSessionChanged={onSessionChanged}
        />
      </SettingSection>
    </section>
  );
}
