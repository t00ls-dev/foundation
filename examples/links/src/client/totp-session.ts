import { z } from "zod";
import { authClient } from "./auth-client.js";

const sessionSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    twoFactorEnabled: z.boolean().optional(),
  }),
  session: z.object({ id: z.string() }),
});

export async function readTotpSession(signal: AbortSignal) {
  const result = await authClient.getSession({
    query: { disableCookieCache: true, disableRefresh: true },
    fetchOptions: { signal, retry: 0, disableSignal: true },
  });
  if (result.error) throw new Error("Could not resolve authoritative session");
  return result.data === null ? null : sessionSchema.parse(result.data);
}
