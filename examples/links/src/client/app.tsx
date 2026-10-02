import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
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
import { authDestination, authPath } from "./auth-destination.js";
import {
  invalidateSessionGeneration,
  setSessionIdentity,
} from "./session-generation.js";

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [expired, setExpired] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [logoutSource, setLogoutSource] = useState<string | null>(null);
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
  const blocked =
    session.isPending || signingOut || (session.error && (!expired || isReset));
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
    <main className="shell">
      <header className="app-header">
        <Link to="/" className="brand">
          Foundation
        </Link>
        <nav className="cluster" aria-label="Main navigation">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/bookmarks">Bookmarks</NavLink>
        </nav>
        {user ? (
          <div className="account">
            <span>{user.name}</span>
            <nav className="cluster" aria-label="Account navigation">
              <NavLink to="/account">Account</NavLink>
              <button disabled={signingOut} onClick={() => void signOut()}>
                {signingOut ? "Signing out..." : "Sign out"}
              </button>
            </nav>
          </div>
        ) : !blocked ? (
          <nav className="cluster" aria-label="Account navigation">
            <Link to={authPath("/login", destination)}>Sign in</Link>
            <Link to={authPath("/signup", destination)}>Create account</Link>
          </nav>
        ) : null}
      </header>
      {logoutError ? <p role="alert">{logoutError}</p> : null}
      {sessionExpired ? (
        <p role="status">Your session expired. Sign in again to continue.</p>
      ) : null}
      {session.isPending || signingOut ? (
        <p role="status">
          {signingOut ? "Signing out..." : "Loading your session..."}
        </p>
      ) : session.error && (!expired || isReset) ? (
        <section>
          <h1>Unable to load your session</h1>
          <p role="alert">Please check your connection.</p>
          <button onClick={() => void session.refetch()}>Try again</button>
        </section>
      ) : null}
      {isHome ? (
        <Home showSignIn={!user && !blocked} />
      ) : !blocked ? (
        <Routes key={user?.id ?? "anonymous"}>
          <Route
            path="/login"
            element={
              user ? (
                <Navigate to={destination} replace />
              ) : (
                <AuthPage mode="login" onSignedIn={signedIn} />
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
            element={<AuthPage mode="recover" onSignedIn={signedIn} />}
          />
          <Route path="/verify-email" element={<Verification />} />
          <Route
            path="/reset-password"
            element={<ResetPassword authenticated={Boolean(user)} />}
          />
          <Route
            path="/account"
            element={privatePage(
              user ? (
                <AccountSettings
                  user={user}
                  onSessionChanged={signedIn}
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
          <Route path="/bookmarks" element={privatePage(<BookmarkLibrary />)} />
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
  );
}
