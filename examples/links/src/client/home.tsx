import { Link } from "react-router";
import { Button } from "@t00ls-dev/ui/components/button";

export function Home() {
  return (
    <section className="container--narrow home-intro" aria-label="Links">
      <h1>Links</h1>
      <p>Your private bookmark library.</p>
      <div className="actions">
        <Button asChild>
          <Link to="/bookmarks">Open Links</Link>
        </Button>
      </div>
      <p className="home-attribution">Built with Foundation</p>
    </section>
  );
}
