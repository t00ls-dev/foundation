import { AccountSecurity } from "./account-security.js";
import { AccountName } from "./account-name.js";
import { AccountTotp } from "./account-totp.js";
import { useLocation } from "react-router";

export function AccountSettings({
  user,
  onSessionChanged,
  onNameChanged,
  sessionId,
}: {
  user: { id: string; name: string; email: string };
  onSessionChanged: () => Promise<void>;
  onNameChanged: () => Promise<void>;
  sessionId: string;
}) {
  const location = useLocation();
  return (
    <section className="container--narrow stack" aria-label="Account settings">
      <h1 className="cross-page-title">Account Settings</h1>
      <AccountName user={user} onNameChanged={onNameChanged} />
      <AccountSecurity user={user} onSessionChanged={onSessionChanged} />
      <AccountTotp
        key={`${sessionId}:${location.key}`}
        user={user}
        sessionId={sessionId}
        onSessionChanged={onSessionChanged}
      />
    </section>
  );
}
