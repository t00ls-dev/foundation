// Presentation-only observation, scoped to this tab and expected email. It is
// never evidence of session, enabled state or setup integrity. No credentials.
const key = "links:authenticator-recovery";

export function readAuthenticatorRecovery(): string | null {
  try {
    const email = sessionStorage.getItem(key);
    return email &&
      email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? email.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

export function writeAuthenticatorRecovery(email: string | null) {
  try {
    if (email) sessionStorage.setItem(key, email.toLowerCase());
    else sessionStorage.removeItem(key);
  } catch {
    // Storage may be unavailable; the current SPA still retains its observation.
  }
}
