import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "@t00ls-dev/ui/components/button";
import { Skeleton } from "@t00ls-dev/ui/components/skeleton";
import { PendingButton } from "@t00ls-dev/ui/patterns/pending-button";
import { InlineFeedback } from "@t00ls-dev/ui/patterns/inline-feedback";
import { useConfirmedFeedback } from "@t00ls-dev/ui/patterns/feedback";
import { z } from "zod";
import {
  bookmarkInputSchema,
  bookmarkResponseSchema,
  type Bookmark,
} from "../shared/bookmarks.js";
import { ApiError, apiRequest } from "./api.js";
import { currentSessionGeneration } from "./session-generation.js";
import { bookmarkReturnPath } from "./bookmark-navigation.js";

const editorSchema = z.object({
  title: bookmarkInputSchema.shape.title,
  url: bookmarkInputSchema.shape.url,
  description: z.string().trim().max(2000),
  tagsText: z.string().superRefine((value, context) => {
    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const parsed = bookmarkInputSchema.shape.tags.safeParse(tags);
    if (!parsed.success)
      context.addIssue({
        code: "custom",
        message: "Use at most 10 tags, each up to 40 characters",
      });
  }),
});
type EditorValues = z.infer<typeof editorSchema>;

export function BookmarkEditor() {
  const { id } = useParams();
  return <BookmarkEditorTask key={id ?? "new"} id={id} />;
}

function BookmarkEditorTask({ id }: { id: string | undefined }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = bookmarkReturnPath(params.get("returnTo"));
  const confirmed = useConfirmedFeedback();
  const mounted = useRef(false);
  const busy = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      mutation.current?.abort();
    };
  }, []);
  const [item, setItem] = useState<Bookmark>();
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const form = useForm<EditorValues>({
    resolver: zodResolver(editorSchema),
    defaultValues: { title: "", url: "", description: "", tagsText: "" },
  });
  const { reset } = form;
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setItem(undefined);
    void apiRequest(`/api/bookmarks/${id}`, bookmarkResponseSchema, {
      signal: controller.signal,
    })
      .then((bookmark) => {
        if (!controller.signal.aborted) {
          setItem(bookmark);
          reset({
            title: bookmark.title,
            url: bookmark.url,
            description: bookmark.description ?? "",
            tagsText: bookmark.tags.join(", "),
          });
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof ApiError && failure.status === 404
              ? "Bookmark not found"
              : "Could not load the bookmark. Please try again.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, reset, revision]);
  async function save(values: EditorValues) {
    const generation = currentSessionGeneration();
    const controller = new AbortController();
    mutation.current = controller;
    const active = () =>
      mounted.current &&
      !controller.signal.aborted &&
      generation === currentSessionGeneration();
    setError("");
    const input = bookmarkInputSchema.parse({
      title: values.title,
      url: values.url,
      description: values.description,
      tags: values.tagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    try {
      await apiRequest(
        id ? `/api/bookmarks/${id}` : "/api/bookmarks",
        bookmarkResponseSchema,
        {
          method: id ? "PATCH" : "POST",
          body: JSON.stringify(input),
          signal: controller.signal,
        },
      );
      if (!active()) return;
      await navigate(destination);
      if (generation === currentSessionGeneration())
        confirmed(
          crypto.randomUUID(),
          id ? "Bookmark saved." : "Bookmark added.",
        );
    } catch (failure) {
      if (!active()) return;
      setError(
        failure instanceof ApiError
          ? failure.message
          : "We couldn't confirm whether the bookmark was saved. Check the list before trying again.",
      );
    } finally {
      if (mutation.current === controller) mutation.current = null;
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    void form
      .handleSubmit(save)(event)
      .finally(() => {
        busy.current = false;
      });
  }
  const pending = form.formState.isSubmitting;
  return (
    <section className="editor bookmark-editor">
      <h1>{id ? "Edit bookmark" : "Add bookmark"}</h1>
      {loading ? (
        <>
          <p role="status" className="sr-only">
            Loading bookmark...
          </p>
          <div
            className="card bookmark-editor-placeholder"
            role="region"
            aria-label="Loading bookmark form"
            aria-busy="true"
          >
            {(["title", "url", "description", "tagsText"] as const).map(
              (field) => (
                <div key={field} className={`bookmark-field-${field} stack`}>
                  <Skeleton className="h-5 w-24" />
                  <Skeleton
                    className={
                      field === "description" ? "h-28 w-full" : "h-11 w-full"
                    }
                  />
                </div>
              ),
            )}
            <Skeleton className="h-11 w-full" />
          </div>
        </>
      ) : id && !item ? (
        <div className="card bookmark-state">
          <InlineFeedback tone="error" announce="assertive">
            {error}
          </InlineFeedback>
          <Button onClick={() => setRevision((value) => value + 1)}>
            Try again
          </Button>
        </div>
      ) : (
        <form noValidate aria-busy={pending} onSubmit={submit}>
          {(["title", "url", "description", "tagsText"] as const).map(
            (name) => {
              const labels = {
                title: "Title",
                url: "URL",
                description: "Description (optional)",
                tagsText: "Tags (comma-separated)",
              };
              const fieldError = form.formState.errors[name];
              return (
                <div
                  className={`bookmark-field bookmark-field-${name}`}
                  key={name}
                >
                  <label htmlFor={`bookmark-${name}`}>
                    {labels[name]}
                    {name === "description" ? (
                      <textarea
                        {...form.register(name)}
                        id={`bookmark-${name}`}
                        rows={4}
                        readOnly={pending}
                        aria-invalid={!!fieldError}
                        aria-describedby={
                          fieldError ? `error-${name}` : undefined
                        }
                      />
                    ) : (
                      <input
                        {...form.register(name)}
                        id={`bookmark-${name}`}
                        type={name === "url" ? "url" : "text"}
                        readOnly={pending}
                        required={name === "title" || name === "url"}
                        aria-invalid={!!fieldError}
                        aria-describedby={
                          fieldError ? `error-${name}` : undefined
                        }
                      />
                    )}
                  </label>
                  {fieldError ? (
                    <span
                      className="field-error"
                      id={`error-${name}`}
                      role="alert"
                    >
                      {fieldError.message}
                    </span>
                  ) : null}
                </div>
              );
            },
          )}
          <div className="actions">
            <PendingButton
              pending={pending}
              pendingLabel="Saving..."
              type="submit"
              className="text-inherit"
            >
              Save bookmark
            </PendingButton>
            <Link className="button button--secondary" to={destination}>
              Cancel
            </Link>
          </div>
          {error ? (
            <InlineFeedback
              className="bookmark-feedback"
              tone="error"
              announce="assertive"
            >
              {error}
            </InlineFeedback>
          ) : null}
        </form>
      )}
      {id && !item ? <Link to={destination}>Back to bookmarks</Link> : null}
    </section>
  );
}
