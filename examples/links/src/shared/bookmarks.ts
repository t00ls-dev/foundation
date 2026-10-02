import { z } from "zod";

const editableFields = {
  title: z.string().trim().min(1, "Enter a title").max(200),
  url: z
    .string()
    .trim()
    .max(2048)
    .url("Enter an absolute URL")
    .refine((value) => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS URL"),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .transform((value) => value || null),
  tags: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .min(1)
        .max(40)
        .refine((tag) => !tag.includes(","), "Tags cannot contain commas"),
    )
    .max(10)
    .transform((tags) => [...new Set(tags)]),
};

export const bookmarkInputSchema = z.strictObject({
  ...editableFields,
  description: editableFields.description.default(null),
  tags: editableFields.tags.default([]),
});

export const bookmarkUpdateSchema = z
  .strictObject(editableFields)
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field",
  );

export const bookmarkQuerySchema = z.strictObject({
  q: z.string().trim().max(200).default(""),
  tag: z.string().trim().toLowerCase().max(40).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const bookmarkIdSchema = z.uuid();
export const bookmarkResponseSchema = bookmarkInputSchema.extend({
  id: bookmarkIdSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const bookmarkListSchema = z.object({
  items: z.array(bookmarkResponseSchema),
  hasMore: z.boolean(),
});

export type BookmarkInput = z.output<typeof bookmarkInputSchema>;
export type BookmarkUpdate = z.output<typeof bookmarkUpdateSchema>;
export type BookmarkQuery = z.output<typeof bookmarkQuerySchema>;
export type Bookmark = z.output<typeof bookmarkResponseSchema>;
export type BookmarkList = z.output<typeof bookmarkListSchema>;
