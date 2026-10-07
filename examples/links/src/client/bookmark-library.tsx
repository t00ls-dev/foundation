import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router";
import { z } from "zod";
import { Button } from "@t00ls-dev/ui/components/button";
import { Input } from "@t00ls-dev/ui/components/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@t00ls-dev/ui/components/collapsible";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import { Skeleton } from "@t00ls-dev/ui/components/skeleton";
import { Spinner } from "@t00ls-dev/ui/components/spinner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@t00ls-dev/ui/components/alert-dialog";
import { PendingButton } from "@t00ls-dev/ui/patterns/pending-button";
import { InlineFeedback } from "@t00ls-dev/ui/patterns/inline-feedback";
import { useConfirmedFeedback } from "@t00ls-dev/ui/patterns/feedback";
import {
  bookmarkListSchema,
  type Bookmark,
  type BookmarkList,
} from "../shared/bookmarks.js";
import { apiRequest } from "./api.js";
import { currentSessionGeneration } from "./session-generation.js";
import {
  bookmarkTaskPath,
  libraryFilters,
  libraryPath,
  type LibraryFilters,
} from "./bookmark-navigation.js";

export function BookmarkLibrary() {
  const [params, setParams] = useSearchParams();
  const filters = libraryFilters(params);
  const { q: query, tag: filterTag, offset } = filters;
  const [q, setQ] = useState(query);
  const [tag, setTag] = useState(filterTag);
  const [filterOpen, setFilterOpen] = useState(Boolean(filterTag));
  useLayoutEffect(() => {
    setQ(query);
    setTag(filterTag);
    if (filterTag) setFilterOpen(true);
  }, [query, filterTag]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    data: BookmarkList;
    filters: LibraryFilters;
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [target, setTarget] = useState<Pick<
    Bookmark,
    "id" | "title" | "url"
  > | null>(null);
  const [deleting, setDeleting] = useState("");
  const busy = useRef(false);
  const mounted = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const confirmed = useConfirmedFeedback();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      mutation.current?.abort();
    };
  }, []);

  function changeFilters(next: LibraryFilters) {
    setLoading(true);
    setParams(new URLSearchParams(libraryPath(next).split("?")[1] ?? ""));
  }

  function refresh() {
    setLoading(true);
    setRevision((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const requested = { q: query, tag: filterTag, offset };
    const search = new URLSearchParams({
      q: query,
      tag: filterTag,
      offset: String(offset),
      limit: "20",
    });
    void apiRequest(`/api/bookmarks?${search}`, bookmarkListSchema, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        // Empty out-of-range pages are not an empty library. Delete uses the
        // immediately preceding page; other stale/deep links recover to page 1.
        if (!data.items.length && offset > 0) {
          setParams(
            new URLSearchParams(
              libraryPath({ ...requested, offset: 0 }).split("?")[1] ?? "",
            ),
            { replace: true },
          );
          return;
        }
        setResult({ data, filters: requested });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Could not load your bookmarks. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, filterTag, offset, revision, setParams]);

  async function remove() {
    if (!target || busy.current || loading) return;
    busy.current = true;
    const selected = target;
    const displayed = result;
    const generation = currentSessionGeneration();
    const controller = new AbortController();
    mutation.current = controller;
    const active = () =>
      mounted.current &&
      !controller.signal.aborted &&
      generation === currentSessionGeneration();
    setDeleting(selected.id);
    setMutationError("");
    try {
      await apiRequest(`/api/bookmarks/${selected.id}`, z.undefined(), {
        method: "DELETE",
        signal: controller.signal,
      });
      if (!active()) return;
      setLoading(true);
      setResult((current) =>
        current
          ? {
              ...current,
              data: {
                ...current.data,
                items: current.data.items.filter(
                  (item) => item.id !== selected.id,
                ),
              },
            }
          : current,
      );
      setTarget(null);
      if (
        displayed &&
        displayed.data.items.length === 1 &&
        !displayed.data.hasMore &&
        displayed.filters.offset > 0
      ) {
        changeFilters({
          ...displayed.filters,
          offset: Math.max(0, displayed.filters.offset - 20),
        });
      }
      setRevision((value) => value + 1);
      confirmed(crypto.randomUUID(), "Bookmark deleted.");
    } catch {
      if (active())
        setMutationError(
          "We couldn't confirm whether the bookmark was deleted. Refresh the list before trying again.",
        );
    } finally {
      busy.current = false;
      if (mutation.current === controller) mutation.current = null;
      if (active()) setDeleting("");
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    changeFilters({ q: q.trim(), tag: tag.trim(), offset: 0 });
    setRevision((value) => value + 1);
  }
  const data = result?.data;
  const displayedFilters = result?.filters ?? filters;
  const matchesQuery =
    displayedFilters.q === query &&
    displayedFilters.tag === filterTag &&
    displayedFilters.offset === offset;
  return (
    <section className="bookmark-library">
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            Bookmarks
          </h1>
        </div>
        <Button asChild className="add-bookmark">
          <Link
            aria-label="Add bookmark"
            to={bookmarkTaskPath("/bookmarks/new", displayedFilters)}
          >
            <Plus size={20} aria-hidden="true" />
            <span className="add-bookmark-label">Add bookmark</span>
          </Link>
        </Button>
      </div>
      <form className="search" onSubmit={search} aria-label="Search bookmarks">
        <div className="bookmark-filter-row">
          <label className="bookmark-search">
            <span className="sr-only">Search</span>
            <Input
              name="q"
              value={q}
              maxLength={200}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search bookmarks…"
            />
          </label>
          <Button
            className="bookmark-search-submit text-inherit"
            disabled={!!deleting}
            type="submit"
          >
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search</span>
          </Button>
        </div>
        <Collapsible open={filterOpen} onOpenChange={setFilterOpen}>
          <div className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost">
                Tag{filterTag ? `: ${filterTag}` : ""}
                <ChevronDown size={16} aria-hidden="true" />
              </Button>
            </CollapsibleTrigger>
            {q || tag || query || filterTag ? (
              <Button
                variant="ghost"
                type="button"
                disabled={!!deleting}
                onClick={() => {
                  setQ("");
                  setTag("");
                  changeFilters({ q: "", tag: "", offset: 0 });
                  setRevision((value) => value + 1);
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
          <CollapsibleContent>
            <div className="bookmark-filter-row">
              <label className="bookmark-tag">
                Tag
                <Input
                  name="tag"
                  value={tag}
                  maxLength={40}
                  onChange={(event) => setTag(event.target.value)}
                  placeholder="e.g. design (exact match)"
                />
              </label>
              <Button type="submit" variant="outline" disabled={!!deleting}>
                Apply tag
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </form>
      {(loading && result) || mutationError ? (
        <div className="bookmark-update">
          <p role="status" className="bookmark-update-label">
            {loading ? (
              <>
                <Spinner />
                <span className={matchesQuery ? "sr-only" : undefined}>
                  {matchesQuery
                    ? "Updating bookmarks…"
                    : "Updating results — showing previous results."}
                </span>
              </>
            ) : null}
          </p>
          {mutationError ? (
            <Button
              variant="ghost"
              disabled={loading || !!deleting}
              onClick={refresh}
            >
              Refresh list
            </Button>
          ) : null}
        </div>
      ) : null}
      {mutationError && !target ? (
        <InlineFeedback tone="error" announce="assertive">
          {mutationError}
        </InlineFeedback>
      ) : null}
      {error ? (
        <div className="bookmark-state">
          <InlineFeedback tone="error" announce="assertive">
            {error}
            {result ? " Showing previously loaded results." : ""}
          </InlineFeedback>
          <Button disabled={loading || !!deleting} onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : null}
      <div role="region" aria-label="Bookmark results" aria-busy={loading}>
        {loading && (!data || !data.items.length) ? (
          <div className="bookmarks" aria-label="Loading bookmark rows">
            {[0, 1, 2].map((index) => (
              <div className="card bookmark-card bookmark-skeleton" key={index}>
                <Skeleton className="h-7 w-3/4" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ) : data?.items.length ? (
          <>
            <div className="bookmarks">
              {data.items.map((item) => (
                <article
                  className="bookmark-card"
                  key={item.id}
                  aria-label={item.title}
                >
                  <h2>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="min-w-0 line-clamp-2">{item.title}</span>
                      <ExternalLink size={14} aria-hidden="true" />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </h2>
                  <p className="bookmark-url">{item.url}</p>
                  {item.description ? (
                    <p className="bookmark-description">{item.description}</p>
                  ) : null}
                  {item.tags.length ? (
                    <ul className="tags" aria-label="Tags">
                      {item.tags.map((value) => (
                        <li key={value}>{value}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="actions">
                    <Button asChild variant="ghost">
                      <Link
                        to={bookmarkTaskPath(
                          `/bookmarks/${item.id}/edit`,
                          displayedFilters,
                        )}
                      >
                        <Pencil size={16} aria-hidden="true" />
                        Edit
                      </Link>
                    </Button>
                    <PendingButton
                      variant="ghost"
                      className="text-inherit"
                      pending={deleting === item.id}
                      pendingLabel="Deleting..."
                      disabled={loading || !!deleting}
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setMutationError("");
                        setTarget({
                          id: item.id,
                          title: item.title,
                          url: item.url,
                        });
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      Delete
                    </PendingButton>
                  </div>
                </article>
              ))}
            </div>
            {displayedFilters.offset > 0 || data.hasMore ? (
              <nav className="pagination" aria-label="Bookmark pages">
                <Button
                  disabled={
                    loading || !!deleting || displayedFilters.offset === 0
                  }
                  onClick={() =>
                    changeFilters({
                      ...displayedFilters,
                      offset: Math.max(0, displayedFilters.offset - 20),
                    })
                  }
                >
                  Previous
                </Button>
                <span>Page {Math.floor(displayedFilters.offset / 20) + 1}</span>
                <Button
                  disabled={loading || !!deleting || !data.hasMore}
                  onClick={() =>
                    changeFilters({
                      ...displayedFilters,
                      offset: displayedFilters.offset + 20,
                    })
                  }
                >
                  Next
                </Button>
              </nav>
            ) : null}
          </>
        ) : data && !loading && matchesQuery ? (
          <div className="empty">
            <h2>
              {displayedFilters.q || displayedFilters.tag
                ? "No matching bookmarks"
                : "No bookmarks yet"}
            </h2>
            <p>
              {displayedFilters.q || displayedFilters.tag
                ? "Try another search or clear your filters."
                : "Save your first bookmark to get started."}
            </p>
          </div>
        ) : null}
      </div>
      <AlertDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current?.isConnected && !opener.current.disabled)
              opener.current.focus();
            else heading.current?.focus();
          }}
        >
          <AlertDialogTitle>Delete bookmark?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete <strong className="text-foreground">{target?.title}</strong>?
            This cannot be undone.
            <span className="mt-2 block break-all">{target?.url}</span>
          </AlertDialogDescription>
          {mutationError ? (
            <InlineFeedback tone="error" announce="assertive">
              {mutationError}
            </InlineFeedback>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <PendingButton
                variant="destructive"
                pending={!!deleting}
                pendingLabel="Deleting..."
                disabled={loading}
                onClick={(event) => {
                  event.preventDefault();
                  void remove();
                }}
              >
                Delete bookmark
              </PendingButton>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
