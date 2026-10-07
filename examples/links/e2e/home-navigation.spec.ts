import { expect, test, type Page } from "@playwright/test";
import { openNavigation } from "./navigation.js";
import { z } from "zod";
import { extractEmailUrl } from "../test/email-link.js";

const password = "correct-horse-battery-staple";
const origin = "http://127.0.0.1:5174";

async function mail(page: Page, email: string, subject: string) {
  const response = await page.request.get(
    `/__test/mail?${new URLSearchParams({ email, subject })}`,
  );
  expect(response.ok()).toBe(true);
  return extractEmailUrl(
    z.object({ text: z.string() }).parse(await response.json()).text,
    origin,
  );
}

async function account(page: Page) {
  const email = `navigation-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { name: "Navigation Reader", email, password },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.get(
        await mail(page, email, "Verify your email for Links"),
      )
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        headers: { Origin: origin },
        data: { email, password },
      })
    ).ok(),
  ).toBe(true);
  return email;
}

async function bookmark(page: Page) {
  const response = await page.request.post("/api/bookmarks", {
    headers: { Origin: origin },
    data: { title: "Navigation private link", url: "https://example.com" },
  });
  expect(response.status()).toBe(201);
  return z.object({ id: z.uuid() }).parse(await response.json()).id;
}

test("Home is public, concise and reflows without loading private data", async ({
  page,
}) => {
  let privateRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/bookmarks"))
      privateRequests++;
  });
  for (const width of [320, 375, 640, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Links", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Your private bookmark library.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Built with Foundation", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Account navigation" })
        .getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open Links", exact: true }),
    ).toHaveAttribute("href", "/bookmarks");
    for (const zoom of ["1", "2"]) {
      await page.evaluate((value) => {
        document.documentElement.style.zoom = value;
      }, zoom);
      const sizes = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(sizes[0]).toBeLessThanOrEqual(sizes[1]!);
    }
  }
  expect(privateRequests).toBe(0);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  await page.getByRole("link", { name: "Open Links", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("authenticated Home and navigation lead to Bookmarks, editor and unchanged Security", async ({
  page,
}) => {
  await account(page);
  const id = await bookmark(page);
  await page.goto("/");
  await openNavigation(page);
  await expect(
    page.getByRole("heading", { name: "Links", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Navigation private link", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Open Links", exact: true }).click();
  await expect(page).toHaveURL(/\/bookmarks$/);
  await page.reload();
  await expect(
    page.getByRole("article", { name: "Navigation private link" }),
  ).toBeVisible();
  await openNavigation(page);
  await expect(
    page
      .getByRole("navigation", { name: "Account navigation" })
      .getByRole("link", { name: "Bookmarks", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto(`/bookmarks/${id}/edit`);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Navigation private link",
  );
  await page
    .getByRole("link", { name: "Back to bookmarks", exact: true })
    .click();
  await expect(page).toHaveURL(/\/bookmarks$/);
  await openNavigation(page);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await openNavigation(page);
  await page
    .getByRole("navigation", { name: "Account navigation" })
    .getByRole("link", { name: "Bookmarks", exact: true })
    .click();
  await expect(page).toHaveURL(/\/bookmarks$/);
  await page.getByRole("link", { name: "Links", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await openNavigation(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Account navigation" })
      .getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Links", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your session expired. Sign in again to continue."),
  ).toHaveCount(0);
});

test("private deep links return to the requested editor after sign-in", async ({
  page,
}) => {
  const email = await account(page);
  const id = await bookmark(page);
  await page.context().clearCookies();
  const target = `/bookmarks/${id}/edit?source=link`;
  await page.goto(target);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("next")).toBe(target);
  await expect(
    page.getByText("Navigation private link", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${origin}${target}`);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Navigation private link",
  );
  await page.goto("/login?next=https%3A%2F%2Fevil.example%2Fbookmarks");
  await expect(page).toHaveURL(/\/bookmarks$/);
});

test("Magic Link and Google preserve validated internal return destinations", async ({
  page,
}) => {
  const email = await account(page);
  await page.context().clearCookies();
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { googleEnabled: true, turnstile: { status: "disabled" } },
    }),
  );
  const payloads: unknown[] = [];
  await page.route("**/api/auth/sign-in/social", async (route) => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 500, json: { message: "not rendered" } });
  });
  await page.goto("/bookmarks/new");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not sign in with Google. Please try again.",
  );
  expect(payloads[0]).toEqual({
    provider: "google",
    callbackURL: "/bookmarks/new",
    newUserCallbackURL: "/bookmarks/new",
    errorCallbackURL: "/login?oauth=failed&next=%2Fbookmarks%2Fnew",
  });
  await page.goto(
    "/login?oauth=failed&error=access_denied&next=%2Fbookmarks%2Fnew",
  );
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not sign in with Google. Please try again.",
  );
  expect(new URL(page.url()).searchParams.get("next")).toBe("/bookmarks/new");
  expect(payloads[1]).toEqual(payloads[0]);
  await page
    .getByRole("navigation", { name: "Authentication options" })
    .getByRole("link", { name: "Use a magic link" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Magic link", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Check your email for a sign-in link.", { exact: true }),
  ).toBeVisible();
  await page.goto(await mail(page, email, "Sign in to Links"));
  await expect(page).toHaveURL(/\/bookmarks\/new$/);
  await expect(
    page.getByRole("heading", { name: "Add bookmark", exact: true }),
  ).toBeVisible();
});

test("expired private sessions reach sign-in without retaining private content", async ({
  page,
  request,
}) => {
  await account(page);
  await bookmark(page);
  await page.goto("/bookmarks");
  await expect(page.getByRole("article")).toBeVisible();
  const cookie = (await page.context().cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");
  expect(
    (
      await request.post("/api/auth/sign-out", {
        headers: { Origin: origin, Cookie: cookie },
        data: {},
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByText("Your session expired. Sign in again to continue."),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(
    page.getByText("Navigation Reader", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Navigation private link", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Links", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Links", exact: true }),
  ).toBeVisible();
});

test("Home remains available during session loading and recoverable errors", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/get-session*", async (route) => {
    await held;
    await route
      .fulfill({ status: 500, json: { message: "Unavailable" } })
      .catch(() => undefined);
  });
  await page.goto("/");
  await expect(
    page.getByRole("progressbar", { name: "Loading session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Links", exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "Unable to load your session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Links", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/auth/get-session*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Account navigation" })
      .getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("signup and email verification preserve the requested private destination", async ({
  page,
}) => {
  const email = `signup-navigation-${crypto.randomUUID()}@example.com`;
  await page.goto("/bookmarks/new");
  await page
    .getByRole("navigation", { name: "Authentication options" })
    .getByRole("link", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create account", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("New Navigation Reader");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("next")).toBe("/bookmarks/new");
  await page.goto(await mail(page, email, "Verify your email for Links"));
  await expect(
    page.getByRole("heading", { name: "Email verified" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("next")).toBe("/bookmarks/new");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/bookmarks\/new$/);
  await expect(
    page.getByRole("heading", { name: "Add bookmark", exact: true }),
  ).toBeVisible();
});

test("logout on the public reset page preserves the existing password reset flow", async ({
  page,
}) => {
  const email = await account(page);
  expect(
    (
      await page.request.post("/api/auth/request-password-reset", {
        headers: { Origin: origin },
        data: { email, redirectTo: "/reset-password" },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(await mail(page, email, "Reset your Links password"));
  await expect(
    page.getByRole("heading", { name: "New password", exact: true }),
  ).toBeVisible();
  const resetURL = page.url();
  await openNavigation(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Password reset options" })
      .getByRole("link", { name: "Back to sign in", exact: true }),
  ).toHaveAttribute("href", "/login");
  await expect(
    page.getByRole("navigation", { name: "Account navigation" }),
  ).toHaveCount(0);
  expect(
    await (await page.request.get("/api/auth/get-session")).json(),
  ).toBeNull();
  await expect(page).toHaveURL(resetURL);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(
    page.getByRole("heading", { name: "Password updated", exact: true }),
  ).toBeVisible();
});
