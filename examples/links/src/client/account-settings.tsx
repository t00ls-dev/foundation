import { AccountSecurity } from "./account-security.js";
import { AccountName } from "./account-name.js";

export function AccountSettings({
  user,
  onSessionChanged,
  onNameChanged,
}: {
  user: { id: string; name: string; email: string };
  onSessionChanged: () => Promise<void>;
  onNameChanged: () => Promise<void>;
}) {
  return (
    <section className="container--narrow stack" aria-label="Account settings">
      <h1 className="cross-page-title">Account Settings</h1>
      <AccountName user={user} onNameChanged={onNameChanged} />
      <AccountSecurity user={user} onSessionChanged={onSessionChanged} />
    </section>
  );
}
