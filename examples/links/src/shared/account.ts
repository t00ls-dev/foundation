import { z } from "zod";

export const accountNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(200, "Name must be at most 200 characters")
  .refine(
    (name) => !/\p{Cc}/u.test(name),
    "Use a name without control characters",
  );

export const accountUpdateSchema = z.strictObject({ name: accountNameSchema });
