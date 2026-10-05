import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Skeleton } from "@t00ls-dev/ui/components/skeleton";
import { PendingButton } from "@t00ls-dev/ui/patterns/pending-button";
import { InlineFeedback } from "@t00ls-dev/ui/patterns/inline-feedback";
import {
  FeedbackProvider,
  useConfirmedFeedback,
} from "@t00ls-dev/ui/patterns/feedback";
import {
  PageProgress,
  useProgressOperation,
} from "@t00ls-dev/ui/patterns/page-progress";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { authClient } from "./auth-client.js";
import { AuthPage, ResetPassword, Verification } from "./auth-pages.js";
import { AccountSettings } from "./account-settings.js";
import { BookmarkEditor } from "./bookmark-editor.js";
import { BookmarkLibrary } from "./bookmark-library.js";
import { Home } from "./home.js";
import { TotpChallenge } from "./totp-challenge.js";
import type { PasswordChallenge } from "./totp.js";
import {
  readAuthenticatorRecovery,
  writeAuthenticatorRecovery,
} from "./totp-recovery.js";
import { authDestination, authPath } from "./auth-destination.js";
import {
  invalidateSessionGeneration,
  setSessionIdentity,
} from "./session-generation.js";

function PasswordConfirmation({ operation }: { operation: string }) {
  const confirmed = useConfirmedFeedback();
  useEffect(() => {
    confirmed(
      operation,
      "Password updated. Other sessions have been signed out.",
    );
  }, [confirmed, operation]);
  return null;
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = authClient.useSession();
  const sessionResolved = useRef(false);
  useLayoutEffect(() => {
    if (!session.isPending && !session.error) sessionResolved.current = true;
  }, [session.isPending, session.error]);
  const [challenge, setChallenge] = useState<PasswordChallenge | null>(null);
  const [authenticatorConfirmation, setAuthenticatorConfirmation] = useState<{
    identity: string;
    enabled: boolean;
  } | null>(null);
  const [authenticatorRecoveryEmail, setAuthenticatorRecoveryEmail] = useState<
    string | null
  >(readAuthenticatorRecovery);
  useEffect(() => {
    writeAuthenticatorRecovery(authenticatorRecoveryEmail);
  }, [authenticatorRecoveryEmail]);
  useEffect(() => {
    if (location.pathname !== "/account") setAuthenticatorConfirmation(null);
  }, [location.pathname]);
  useEffect(() => {
    if (location.pathname !== "/two-factor") setChallenge(null);
  }, [location.pathname]);
  const [expired, setExpired] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [logoutSource, setLogoutSource] = useState<string | null>(null);
  const [passwordConfirmation, setPasswordConfirmation] = useState<{
    identity: string;
    operation: string;
  } | null>(null);
  useEffect(() => {
    if (logoutSource && location.pathname !== logoutSource)
      setLogoutSource(null);
  }, [location.pathname, logoutSource]);
  useEffect(() => {
    function unauthorized() {
      invalidateSessionGeneration();
      setExpired(true);
      setSessionExpired(true);
      void session.refetch();
    }
    window.addEventListener("links:unauthorized", unauthorized);
    return () => window.removeEventListener("links:unauthorized", unauthorized);
  }, [session.refetch]);
  const user = !expired ? session.data?.user : undefined;
  const identity =
    user && session.data ? `${user.id}:${session.data.session.id}` : undefined;
  // Runs before private pages start passive-effect requests for this identity.
  useLayoutEffect(() => {
    setSessionIdentity(identity);
  }, [identity]);
  async function signedIn() {
    invalidateSessionGeneration();
    await session.refetch();
    setExpired(false);
    setSessionExpired(false);
  }
  async function signOut() {
    setAuthenticatorConfirmation(null);
    setAuthenticatorRecoveryEmail(null);
    invalidateSessionGeneration();
    setSigningOut(true);
    setLogoutSource(location.pathname);
    setLogoutError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      setExpired(true);
      setSessionExpired(false);
      await session.refetch();
      const privateRoute =
        location.pathname.startsWith("/bookmarks") ||
        location.pathname === "/account" ||
        location.pathname === "/account/security";
      await navigate(
        privateRoute
          ? "/login"
          : `${location.pathname}${location.search}${location.hash}`,
        { replace: true },
      );
    } catch {
      setLogoutSource(null);
      setLogoutError("Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  const isHome = location.pathname === "/";
  const isReset = location.pathname === "/reset-password";
  const destination = authDestination(
    new URLSearchParams(location.search).get("next"),
  );
  // Better Auth retains data during a same-identity refetch. Never cache a
  // private snapshot separately: null/401, expiry and logout remain boundaries.
  const unknown =
    !sessionResolved.current && session.isPending && !session.data && !expired;
  const blocked =
    unknown ||
    signingOut ||
    Boolean(
      session.error && ((!sessionResolved.current && !expired) || isReset),
    );
  useProgressOperation(session.isPending || session.isRefetching);
  useProgressOperation(signingOut);
  function privatePage(page: ReactNode) {
    return user ? (
      page
    ) : (
      <Navigate
        to={
          location.pathname === logoutSource
            ? "/login"
            : authPath(
                "/login",
                `${location.pathname}${location.search}${location.hash}`,
              )
        }
        replace
      />
    );
  }

  return (
    <>
      <PageProgress label={signingOut ? "Signing out" : "Loading session"} />
      <FeedbackProvider
        key={signingOut ? "signing-out" : (identity ?? "anonymous")}
      >
        <main className="shell">
          <header className="app-header">
            <Link to="/" className="brand">
              Foundation
            </Link>
            <nav className="cluster header-main" aria-label="Main navigation">
              <NavLink to="/" end>
                Home
              </NavLink>
              <NavLink to="/bookmarks">Bookmarks</NavLink>
            </nav>
            {user ? (
              <div className="account">
                <span title={user.name}>{user.name}</span>
                <nav
                  className="cluster header-account"
                  aria-label="Account navigation"
                >
                  <NavLink to="/account">Account</NavLink>
                  <PendingButton
                    className="gap-0 px-1 py-1 text-inherit"
                    variant="ghost"
                    pending={signingOut}
                    pendingLabel="Signing out..."
                    onClick={() => void signOut()}
                  >
                    Sign out
                  </PendingButton>
                </nav>
              </div>
            ) : !blocked ? (
              <nav
                className="cluster header-account"
                aria-label="Account navigation"
              >
                <Link to={authPath("/login", destination)}>Sign in</Link>
                <Link to={authPath("/signup", destination)}>
                  Create account
                </Link>
              </nav>
            ) : (
              <div
                className="account"
                role="group"
                aria-busy={session.isPending || session.isRefetching}
                aria-label={
                  session.error ? "Account unavailable" : "Loading account"
                }
              >
                <Skeleton className="ml-auto h-5 w-24" />
                <Skeleton className="ml-auto h-11 w-full max-w-48" />
              </div>
            )}
          </header>
          {!signingOut &&
          passwordConfirmation &&
          passwordConfirmation.identity === identity ? (
            <PasswordConfirmation operation={passwordConfirmation.operation} />
          ) : null}
          {logoutError ? (
            <InlineFeedback tone="error" announce="assertive">
              {logoutError}
            </InlineFeedback>
          ) : null}
          {sessionExpired ? (
            <InlineFeedback>
              Your session expired. Sign in again to continue.
            </InlineFeedback>
          ) : null}
          {unknown && !isHome ? (
            <div
              className="container--narrow stack"
              role="region"
              aria-busy="true"
              aria-label="Loading page"
            >
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : null}
          {session.error && (!expired || isReset) ? (
            <section>
              {!sessionResolved.current ? (
                <h1>Unable to load your session</h1>
              ) : null}
              <InlineFeedback tone="error" announce="assertive">
                {user
                  ? "Could not refresh your session. Please check your connection."
                  : "Please check your connection."}
              </InlineFeedback>
              <button onClick={() => void session.refetch()}>Try again</button>
            </section>
          ) : null}
          {isHome ? (
            <Home showSignIn={!user && !blocked} />
          ) : !blocked ? (
            <Routes key={identity ?? "anonymous"}>
              <Route
                path="/login"
                element={
                  user ? (
                    <Navigate to={destination} replace />
                  ) : (
                    <AuthPage
                      mode="login"
                      onSignedIn={signedIn}
                      onChallenge={(value) => {
                        setChallenge(value);
                        if (!value.available || value.uncertain)
                          setAuthenticatorRecoveryEmail(value.email);
                      }}
                    />
                  )
                }
              />
              <Route
                path="/signup"
                element={
                  user ? (
                    <Navigate to={destination} replace />
                  ) : (
                    <AuthPage mode="signup" onSignedIn={signedIn} />
                  )
                }
              />
              <Route
                path="/magic-link"
                element={<AuthPage mode="magic" onSignedIn={signedIn} />}
              />
              <Route
                path="/forgot-password"
                element={
                  <AuthPage
                    mode="recover"
                    onSignedIn={signedIn}
                    initialEmail={user?.email}
                  />
                }
              />
              <Route path="/verify-email" element={<Verification />} />
              <Route
                path="/two-factor"
                element={
                  <TotpChallenge
                    onAbandon={() => setChallenge(null)}
                    onRecoveryObserved={() => {
                      if (challenge)
                        setAuthenticatorRecoveryEmail(challenge.email);
                    }}
                    challenge={challenge}
                    destination={destination}
                    onSignedIn={signedIn}
                    onReconciling={() => {
                      const pending = challenge
                        ? { ...challenge, reconciling: true }
                        : null;
                      setChallenge(pending);
                      // A completion from an abandoned/older challenge must not
                      // turn a replacement challenge into recovery state.
                      return () =>
                        setChallenge((current) =>
                          current && current === pending
                            ? {
                                ...current,
                                reconciling: false,
                                uncertain: true,
                              }
                            : current,
                        );
                    }}
                  />
                }
              />
              <Route
                path="/reset-password"
                element={<ResetPassword authenticated={Boolean(user)} />}
              />
              <Route
                path="/account"
                element={privatePage(
                  user ? (
                    <AccountSettings
                      authenticatorCompletion={
                        authenticatorConfirmation &&
                        authenticatorConfirmation.identity === identity
                          ? authenticatorConfirmation.enabled
                          : null
                      }
                      onAuthenticatorConfirmed={(
                        confirmedIdentity,
                        enabled,
                      ) => {
                        setAuthenticatorConfirmation(
                          enabled === null
                            ? null
                            : { identity: confirmedIdentity, enabled },
                        );
                        if (enabled !== null)
                          setAuthenticatorRecoveryEmail(null);
                      }}
                      authenticatorRecoveryObserved={
                        authenticatorRecoveryEmail === user.email.toLowerCase()
                      }
                      onAuthenticatorRecoveryObserved={() =>
                        setAuthenticatorRecoveryEmail(user.email.toLowerCase())
                      }
                      user={user}
                      onSessionChanged={signedIn}
                      sessionId={session.data?.session.id ?? ""}
                      onPasswordConfirmed={(confirmedIdentity) => {
                        setPasswordConfirmation({
                          identity: confirmedIdentity,
                          operation: crypto.randomUUID(),
                        });
                      }}
                      onNameChanged={async () => {
                        await session.refetch();
                      }}
                    />
                  ) : null,
                )}
              />
              <Route
                path="/account/security"
                element={
                  <Navigate
                    to={`/account${location.search}${location.hash}`}
                    replace
                  />
                }
              />
              <Route
                path="/bookmarks"
                element={privatePage(<BookmarkLibrary />)}
              />
              <Route
                path="/bookmarks/new"
                element={privatePage(<BookmarkEditor key="new" />)}
              />
              <Route
                path="/bookmarks/:id/edit"
                element={privatePage(<BookmarkEditor />)}
              />
              <Route
                path="*"
                element={<Navigate to={user ? "/bookmarks" : "/"} replace />}
              />
            </Routes>
          ) : null}
        </main>
      </FeedbackProvider>
    </>
  );
}
