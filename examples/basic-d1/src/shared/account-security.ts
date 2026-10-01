import { z } from "zod";

export const accountSecuritySchema = z
  .object({ hasPassword: z.boolean() })
  .strict();
