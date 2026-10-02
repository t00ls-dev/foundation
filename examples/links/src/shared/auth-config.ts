import { z } from "zod";

export const publicAuthConfigSchema = z
  .object({ googleEnabled: z.boolean() })
  .strict();
