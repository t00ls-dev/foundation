import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import {
  bookmarkInputSchema,
  bookmarkResponseSchema,
  type Bookmark,
} from "../shared/bookmarks.js";
import { ApiError, apiRequest } from "./api.js";
import { currentSessionGeneration } from "./session-generation.js";

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
  const navigate = useNavigate();
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
        { method: id ? "PATCH" : "POST", body: JSON.stringify(input) },
      );
      if (generation === currentSessionGeneration()) await navigate("/");
    } catch (failure) {
      if (generation !== currentSessionGeneration()) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save the bookmark",
      );
    }
  }
  const pending = form.formState.isSubmitting;
  return (
    <section className="editor">
      <h1>{id ? "Edit bookmark" : "Add bookmark"}</h1>
      {loading ? (
        <p role="status">Loading bookmark...</p>
      ) : id && !item ? (
        <div>
          <p role="alert">{error}</p>
          <button onClick={() => setRevision((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <form
          noValidate
          aria-busy={pending}
          onSubmit={(event) => void form.handleSubmit(save)(event)}
        >
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
                <label key={name} htmlFor={`bookmark-${name}`}>
                  {labels[name]}
                  {name === "description" ? (
                    <textarea
                      {...form.register(name)}
                      id={`bookmark-${name}`}
                      rows={4}
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
                      required={name === "title" || name === "url"}
                      aria-invalid={!!fieldError}
                      aria-describedby={
                        fieldError ? `error-${name}` : undefined
                      }
                    />
                  )}
                  {fieldError ? (
                    <span
                      className="field-error"
                      id={`error-${name}`}
                      role="alert"
                    >
                      {fieldError.message}
                    </span>
                  ) : null}
                </label>
              );
            },
          )}
          <div className="actions">
            <button disabled={pending} type="submit">
              {pending ? "Saving..." : "Save bookmark"}
            </button>
            <Link to="/">Cancel</Link>
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </form>
      )}
      {id && !item ? <Link to="/">Back to bookmarks</Link> : null}
    </section>
  );
}
