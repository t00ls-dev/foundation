import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { z } from "zod";
import { bookmarkListSchema, type BookmarkList } from "../shared/bookmarks.js";
import { apiRequest } from "./api.js";
import { currentSessionGeneration } from "./session-generation.js";

export function BookmarkLibrary() {
  const [filters, setFilters] = useState({ q: "", tag: "", offset: 0 });
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<BookmarkList>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [deleting, setDeleting] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(undefined);
    const query = new URLSearchParams({
      ...filters,
      offset: String(filters.offset),
      limit: "20",
    });
    void apiRequest(`/api/bookmarks?${query}`, bookmarkListSchema, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Could not load your bookmarks. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, revision]);

  async function remove(id: string) {
    if (!window.confirm("Delete this bookmark?")) return;
    const generation = currentSessionGeneration();
    setDeleting(id);
    setMutationError("");
    try {
      await apiRequest(`/api/bookmarks/${id}`, z.undefined(), {
        method: "DELETE",
      });
      if (generation === currentSessionGeneration())
        setFilters((current) => ({ ...current, offset: 0 }));
    } catch {
      if (generation === currentSessionGeneration())
        setMutationError("Could not delete the bookmark. Please try again.");
    } finally {
      if (generation === currentSessionGeneration()) setDeleting("");
    }
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ q: q.trim(), tag: tag.trim(), offset: 0 });
  }
  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Your bookmarks</h1>
          <p>A private home for things worth keeping.</p>
        </div>
        <Link className="button" to="/bookmarks/new">
          Add link
        </Link>
      </div>
      <form className="search" onSubmit={search} aria-label="Search bookmarks">
        <label>
          Search
          <input
            name="q"
            value={q}
            maxLength={200}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Title, URL or description"
          />
        </label>
        <label>
          Filter by tag
          <input
            name="tag"
            value={tag}
            maxLength={40}
            onChange={(event) => setTag(event.target.value)}
            placeholder="Exact tag"
          />
        </label>
        <button type="submit">Search</button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setQ("");
            setTag("");
            setFilters({ q: "", tag: "", offset: 0 });
          }}
        >
          Clear filters
        </button>
      </form>
      {mutationError ? <p role="alert">{mutationError}</p> : null}
      {loading ? (
        <p role="status">Loading bookmarks...</p>
      ) : error ? (
        <div>
          <p role="alert">{error}</p>
          <button onClick={() => setRevision((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : data?.items.length ? (
        <>
          <div className="bookmarks">
            {data.items.map((item) => (
              <article key={item.id} aria-label={item.title}>
                <h2>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    {item.title}
                  </a>
                </h2>
                <p className="bookmark-url">{item.url}</p>
                {item.description ? <p>{item.description}</p> : null}
                <ul className="tags" aria-label="Tags">
                  {item.tags.map((value) => (
                    <li key={value}>{value}</li>
                  ))}
                </ul>
                <div className="actions">
                  <Link to={`/bookmarks/${item.id}/edit`}>Edit</Link>
                  <button
                    className="secondary"
                    disabled={!!deleting}
                    onClick={() => void remove(item.id)}
                  >
                    {deleting === item.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </article>
            ))}
          </div>
          <nav className="pagination" aria-label="Bookmark pages">
            <button
              disabled={filters.offset === 0}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  offset: Math.max(0, current.offset - 20),
                }))
              }
            >
              Previous
            </button>
            <span>Page {Math.floor(filters.offset / 20) + 1}</span>
            <button
              disabled={!data.hasMore}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  offset: current.offset + 20,
                }))
              }
            >
              Next
            </button>
          </nav>
        </>
      ) : (
        <div className="empty">
          <h2>
            {filters.q || filters.tag
              ? "No matching bookmarks"
              : "No bookmarks yet"}
          </h2>
          <p>
            {filters.q || filters.tag
              ? "Try another search or clear your filters."
              : "Save your first link to get started."}
          </p>
        </div>
      )}
    </section>
  );
}
