import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  bookmarkIdSchema,
  bookmarkInputSchema,
  bookmarkQuerySchema,
  bookmarkUpdateSchema,
} from "../shared/bookmarks.js";
import type { AppEnvironment } from "./auth.js";
import {
  createBookmark,
  deleteBookmark,
  getBookmark,
  listBookmarks,
  updateBookmark,
} from "./bookmark-repository.js";

export const bookmarkRoutes = new Hono<AppEnvironment>();
bookmarkRoutes.use(
  "*",
  bodyLimit({
    maxSize: 16_384,
    onError: (c) =>
      c.json(
        { error: { code: "TOO_LARGE", message: "Request is too large" } },
        413,
      ),
  }),
);

bookmarkRoutes.get("/", async (c) => {
  const query = bookmarkQuerySchema.safeParse(c.req.query());
  if (!query.success) return c.json(invalid(query.error), 400);
  return c.json(
    await listBookmarks(
      c.get("database"),
      c.get("identity").user.id,
      query.data,
    ),
  );
});

bookmarkRoutes.get("/:id", async (c) => {
  const id = bookmarkIdSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.json(notFound, 404);
  const item = await getBookmark(
    c.get("database"),
    c.get("identity").user.id,
    id.data,
  );
  return item ? c.json(item) : c.json(notFound, 404);
});

bookmarkRoutes.post("/", async (c) => {
  if (
    !c.req.header("Content-Type")?.toLowerCase().startsWith("application/json")
  )
    return c.json(unsupported, 415);
  const input = bookmarkInputSchema.safeParse(
    await c.req.json<unknown>().catch(() => null),
  );
  if (!input.success) return c.json(invalid(input.error), 400);
  return c.json(
    await createBookmark(
      c.get("database"),
      c.get("identity").user.id,
      input.data,
    ),
    201,
  );
});

bookmarkRoutes.patch("/:id", async (c) => {
  const id = bookmarkIdSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.json(notFound, 404);
  if (
    !c.req.header("Content-Type")?.toLowerCase().startsWith("application/json")
  )
    return c.json(unsupported, 415);
  const input = bookmarkUpdateSchema.safeParse(
    await c.req.json<unknown>().catch(() => null),
  );
  if (!input.success) return c.json(invalid(input.error), 400);
  const item = await updateBookmark(
    c.get("database"),
    c.get("identity").user.id,
    id.data,
    input.data,
  );
  return item ? c.json(item) : c.json(notFound, 404);
});

bookmarkRoutes.delete("/:id", async (c) => {
  const id = bookmarkIdSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.json(notFound, 404);
  const item = await deleteBookmark(
    c.get("database"),
    c.get("identity").user.id,
    id.data,
  );
  return item ? c.body(null, 204) : c.json(notFound, 404);
});

const notFound = {
  error: { code: "NOT_FOUND", message: "Bookmark not found" },
};
const unsupported = {
  error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Send JSON" },
};
function invalid(error: z.ZodError) {
  return {
    error: {
      code: "VALIDATION",
      message: "Check the submitted fields",
      fields: z.flattenError(error).fieldErrors,
    },
  };
}
