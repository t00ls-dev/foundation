import { expect, test, type Page } from "@playwright/test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { z } from "zod";

const origin = "http://127.0.0.1:5174";
const password = "correct-horse-battery-staple";
const invalidMessage =
  "This password link is invalid, expired, or already used.";
const verificationError =
  "Could not verify this password link. Please try again.";
async function mail(page: Page, email: string, subject: string) {
  const response = await page.request.get(
    `/__test/mail?${new URLSearchParams({ email, subject })}`,
  );
  expect(response.ok()).toBe(true);
  return z.object({ text: z.string().url() }).parse(await response.json()).text;
}
async function issue(page: Page, authenticated = false) {
  const email = `reset-ux-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { email, name: "Reset Reader", password },
      })
    ).status(),
  ).toBe(200);
  if (authenticated) {
    expect(
      (
        await page.request.get(await mail(page, email, "Verify your email"))
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.post("/api/auth/sign-in/email", {
          headers: { Origin: origin },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
  }
  expect(
    (
      await page.request.post("/api/auth/request-password-reset", {
        headers: { Origin: origin },
        data: { email, redirectTo: "/reset-password" },
      })
    ).status(),
  ).toBe(200);
  const token = new URL(await mail(page, email, "Reset your password")).pathname
    .split("/")
    .at(-1)!;
  return { token, url: `/reset-password?${new URLSearchParams({ token })}` };
}
async function fill(page: Page) {
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
}

test("valid reset checks before the form and keeps contextual navigation without a redirect loop", async ({
  page,
}) => {
  const { url } = await issue(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/reset-password/*?*", async (route) => {
    await held;
    await route.continue().catch(() => undefined);
  });
  await page.goto(url);
  await expect(
    page.getByText("Checking password link...", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to sign in", exact: true }),
  ).toBeVisible();
  const original = page.url();
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  release();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  expect(page.url()).toBe(original);
  expect(navigations).toBe(0);
  await fill(page);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(
    page.getByText("Password updated. You can sign in now.", { exact: true }),
  ).toBeVisible();
});

test("missing, invalid and already-used links never display password fields", async ({
  page,
}) => {
  for (const url of [
    "/reset-password",
    "/reset-password?error=INVALID_TOKEN",
    "/reset-password?token=not-a-token",
  ]) {
    await page.goto(url);
    await expect(page.getByRole("alert")).toHaveText(invalidMessage);
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("link", { name: "Request a new password link" }),
    ).toHaveAttribute("href", "/forgot-password");
  }
  const { token, url } = await issue(page);
  expect(
    (
      await page.request.post("/api/auth/reset-password", {
        headers: { Origin: origin },
        data: { token, newPassword: password },
      })
    ).status(),
  ).toBe(200);
  await page.goto(url);
  await expect(page.getByRole("alert")).toHaveText(invalidMessage);
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
});

test("a token consumed after the real preflight is rejected at submit and passwords are removed", async ({
  page,
}) => {
  const { token, url } = await issue(page);
  await page.goto(url);
  await fill(page);
  expect(
    (
      await page.request.post("/api/auth/reset-password", {
        headers: { Origin: origin },
        data: { token, newPassword: password },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("alert")).toHaveText(invalidMessage);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Request a new password link" }),
  ).toBeVisible();
});

test("verification failures retry without confusing HTTP/network/unexpected redirects with invalid tokens", async ({
  page,
}) => {
  const { url } = await issue(page);
  let failure: "http" | "network" | "redirect" | "none" = "http";
  await page.route("**/api/auth/reset-password/*?*", async (route) => {
    if (failure === "http")
      await route.fulfill({ status: 503, body: "unavailable" });
    else if (failure === "network") await route.abort("failed");
    else if (failure === "redirect")
      await route.fulfill({
        status: 302,
        headers: {
          Location: "/reset-password?error=INVALID_TOKEN&extra=unexpected",
        },
      });
    else await route.continue();
  });
  await page.goto(url);
  for (const next of ["network", "redirect", "none"] as const) {
    await expect(page.getByRole("alert")).toHaveText(verificationError);
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(
      0,
    );
    failure = next;
    await page.getByRole("button", { name: "Retry password link" }).click();
  }
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
});

test("leaving reset aborts the preflight and suppresses late feedback", async ({
  page,
}) => {
  const { url } = await issue(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/reset-password/*?*", async (route) => {
    await held;
    await route
      .fulfill({ status: 503, body: "late error" })
      .catch(() => undefined);
  });
  await page.goto(url);
  await expect(
    page.getByText("Checking password link...", { exact: true }),
  ).toBeVisible();
  const aborted = page.waitForEvent("requestfailed", (request) =>
    new URL(request.url()).pathname.startsWith("/api/auth/reset-password/"),
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await aborted;
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByRole("heading", { name: "Foundation", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(verificationError, { exact: true })).toHaveCount(
    0,
  );
});

test("authenticated reset preserves its session and returns to Account", async ({
  page,
}) => {
  const { url } = await issue(page, true);
  const before: unknown = await (
    await page.request.get("/api/auth/get-session")
  ).json();
  await page.goto(url);
  await expect(
    page.getByRole("link", { name: "Back to Account" }),
  ).toHaveAttribute("href", "/account");
  await expect(
    page.getByRole("link", { name: "Back to sign in", exact: true }),
  ).toHaveCount(0);
  await fill(page);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(
    page.getByText("Password updated.", { exact: true }),
  ).toBeVisible();
  expect(
    await (await page.request.get("/api/auth/get-session")).json(),
  ).toEqual(before);
  await page.getByRole("link", { name: "Back to Account" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("pending or failed central session resolution never supplies visitor reset navigation", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/get-session*", async (route) => {
    await held;
    await route
      .fulfill({ status: 503, json: { message: "Unavailable" } })
      .catch(() => undefined);
  });
  await page.goto("/reset-password?token=unknown");
  await expect(
    page.getByRole("progressbar", { name: "Loading session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to sign in", exact: true }),
  ).toHaveCount(0);
  release();
  await expect(
    page.getByRole("heading", { name: "Unable to load your session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to sign in", exact: true }),
  ).toHaveCount(0);
});

test("indeterminate reset failure clears passwords and does not retry or reflect upstream details", async ({
  page,
}) => {
  const { url } = await issue(page);
  await page.goto(url);
  await fill(page);
  let calls = 0;
  await page.route("**/api/auth/reset-password", async (route) => {
    calls++;
    await route.fulfill({ status: 500, json: { message: "unsafe-token/sql" } });
  });
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "We couldn't confirm whether your password was updated.",
  );
  await expect(page.getByText("unsafe-token/sql")).toHaveCount(0);
  expect(calls).toBe(1);
  for (const field of ["New password", "Confirm new password"])
    await expect(page.getByLabel(field, { exact: true })).toHaveValue("");
});

// The production TTL remains one hour. Expiry is exercised through public API
// calls with a one-second memory fixture; no token records are inspected/edited.
test("official expiry results block the form and remain authoritative after preflight", async ({
  page,
}) => {
  await page.goto("/");
  let link = "";
  const auth = betterAuth({
    baseURL: origin,
    secret: "reset-ux-fixture-only-secret-at-least-32-characters",
    database: memoryAdapter({
      user: [],
      account: [],
      session: [],
      verification: [],
    }),
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      resetPasswordTokenExpiresIn: 1,
      sendResetPassword: ({ url }) => {
        link = url;
        return Promise.resolve();
      },
    },
  });
  await auth.api.signUpEmail({
    body: { email: "expiry@example.com", name: "Reader", password },
  });
  await page.route("**/api/auth/reset-password/*?*", async (route) => {
    const url = new URL(route.request().url());
    const response = await auth.api.requestPasswordResetCallback({
      params: { token: url.pathname.split("/").at(-1)! },
      query: { callbackURL: "/reset-password" },
      asResponse: true,
    });
    await route.fulfill({
      status: response.status,
      headers: { Location: response.headers.get("location")! },
    });
  });
  await page.route("**/api/auth/reset-password", async (route) => {
    const data = z
      .object({ token: z.string(), newPassword: z.string() })
      .parse(route.request().postDataJSON());
    const response = await auth.api.resetPassword({
      body: data,
      asResponse: true,
    });
    await route.fulfill({
      status: response.status,
      json: await response.json(),
    });
  });
  async function token() {
    await auth.api.requestPasswordReset({
      body: { email: "expiry@example.com", redirectTo: "/reset-password" },
    });
    return new URL(link).pathname.split("/").at(-1)!;
  }
  const expired = await token();
  await new Promise((resolve) => setTimeout(resolve, 1300));
  await page.goto(`/reset-password?${new URLSearchParams({ token: expired })}`);
  await expect(page.getByRole("alert")).toHaveText(invalidMessage);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const fresh = await token();
  await page.goto(`/reset-password?${new URLSearchParams({ token: fresh })}`);
  await fill(page);
  await new Promise((resolve) => setTimeout(resolve, 1300));
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("alert")).toHaveText(invalidMessage);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});
