import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: globalThis.location.origin,
  plugins: [magicLinkClient()],
});
