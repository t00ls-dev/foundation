import { defineConfig } from "@t00ls-dev/config";

export default defineConfig({
  app: {
    environment: "local",
    name: "links",
  },
  auth: {
    emailPassword: true,
    magicLink: true,
    oauth: [],
  },
  database: {
    binding: "DB",
    dialect: "d1",
  },
  tenancy: false,
});
