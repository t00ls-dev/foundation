import { createAuthClient } from "better-auth/react";
import { magicLinkClient, twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: globalThis.location.origin,
  plugins: [magicLinkClient(), twoFactorClient()],
});
