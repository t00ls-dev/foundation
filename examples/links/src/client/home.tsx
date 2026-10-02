import { Link } from "react-router";

export function Home({ showSignIn }: { showSignIn: boolean }) {
  return (
    <section
      className="container--narrow stack"
      aria-label="Foundation and Links"
    >
      <section className="card">
        <h1>Foundation</h1>
        <p>A reusable foundation for building full-stack applications.</p>
      </section>
      <section className="card">
        <h2>Links</h2>
        <p>
          A small bookmark manager built with Foundation to exercise the stack
          end to end.
        </p>
        <div className="cluster actions">
          <Link className="button" to="/bookmarks">
            Open Links
          </Link>
          {showSignIn ? (
            <Link className="button button--secondary" to="/login">
              Sign in
            </Link>
          ) : null}
        </div>
      </section>
    </section>
  );
}
