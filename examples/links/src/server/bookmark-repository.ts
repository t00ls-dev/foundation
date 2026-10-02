import type { createD1Database } from "@t00ls-dev/db/d1";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { bookmark } from "../schema.js";
import type {
  BookmarkInput,
  BookmarkQuery,
  BookmarkUpdate,
} from "../shared/bookmarks.js";

type Database = ReturnType<typeof createD1Database>;
const columns = {
  id: bookmark.id,
  title: bookmark.title,
  url: bookmark.url,
  description: bookmark.description,
  tags: bookmark.tags,
  createdAt: bookmark.createdAt,
  updatedAt: bookmark.updatedAt,
};

function owned(userId: string, id: string) {
  return and(eq(bookmark.userId, userId), eq(bookmark.id, id));
}

export async function listBookmarks(
  db: Database,
  userId: string,
  query: BookmarkQuery,
) {
  const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select(columns)
    .from(bookmark)
    .where(
      and(
        eq(bookmark.userId, userId),
        query.q
          ? or(
              sql`${bookmark.title} LIKE ${pattern} ESCAPE '\\'`,
              sql`${bookmark.url} LIKE ${pattern} ESCAPE '\\'`,
              sql`${bookmark.description} LIKE ${pattern} ESCAPE '\\'`,
            )
          : undefined,
        query.tag
          ? sql`EXISTS (SELECT 1 FROM json_each(${bookmark.tags}) WHERE json_each.value = ${query.tag})`
          : undefined,
      ),
    )
    .orderBy(desc(bookmark.createdAt), desc(bookmark.id))
    .limit(query.limit + 1)
    .offset(query.offset);
  return {
    items: rows.slice(0, query.limit),
    hasMore: rows.length > query.limit,
  };
}

export async function getBookmark(db: Database, userId: string, id: string) {
  return (
    await db.select(columns).from(bookmark).where(owned(userId, id)).limit(1)
  )[0];
}

export async function createBookmark(
  db: Database,
  userId: string,
  input: BookmarkInput,
) {
  const now = new Date();
  return (
    await db
      .insert(bookmark)
      .values({
        ...input,
        id: crypto.randomUUID(),
        userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning(columns)
  )[0]!;
}

export async function updateBookmark(
  db: Database,
  userId: string,
  id: string,
  input: BookmarkUpdate,
) {
  return (
    await db
      .update(bookmark)
      .set({ ...input, updatedAt: new Date() })
      .where(owned(userId, id))
      .returning(columns)
  )[0];
}

export async function deleteBookmark(db: Database, userId: string, id: string) {
  return (
    await db
      .delete(bookmark)
      .where(owned(userId, id))
      .returning({ id: bookmark.id })
  )[0];
}
