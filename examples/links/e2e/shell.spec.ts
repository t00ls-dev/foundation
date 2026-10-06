import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { extractEmailUrl } from "../test/email-link.js";

const origin = "http://127.0.0.1:5174";
const password = "correct-horse-battery-staple";

async function account(page: Page) {
  const email = `shell-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { email, name: "Shell Reader", password },
      })
    ).ok(),
  ).toBe(true);
  const mail = await page.request.get(
    `/__test/mail?${new URLSearchParams({ email, subject: "Verify your email for Links" })}`,
  );
  const url = z
    .object({
      text: z.string().transform((text) => extractEmailUrl(text, origin)),
    })
    .parse(await mail.json()).text;
  expect((await page.request.get(url)).ok()).toBe(true);
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

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("initial unknown session keeps public auth header minimal and uses accessible reduced-motion progress", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const held = gate();
  await page.route("**/api/auth/get-session**", async (route) => {
    await held.promise;
    await route.continue();
  });
  await page.goto("/login");
  const progress = page.getByRole("progressbar", { name: "Loading session" });
  await expect(progress).toBeVisible();
  expect(await progress.getAttribute("aria-valuenow")).toBeNull();
  await expect(progress.locator("div")).toHaveCSS("animation-name", "none");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Links", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Loading account")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Account navigation" }),
  ).toHaveCount(0);
  await expect(page.getByText("Loading your session...")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  held.release();
  await expect(progress).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  // A known anonymous identity also preserves an unfinished auth form on refetch.
  await page
    .getByLabel("Email", { exact: true })
    .fill("unfinished@example.com");
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "unfinished@example.com",
  );
});

test("same-session refetch and recoverable failure keep the mounted page, header and drafts", async ({
  page,
}) => {
  await account(page);
  await page.goto("/bookmarks/new");
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Unfinished private draft");
  const node = await title.elementHandle();
  const header = await page.locator(".app-header").elementHandle();
  const before = await page.locator(".app-header").boundingBox();
  const held = gate();
  let fail = false;
  await page.route("**/api/auth/get-session**", async (route) => {
    await held.promise;
    if (fail)
      await route.fulfill({
        status: 503,
        json: { code: "SESSION_UNAVAILABLE" },
      });
    else await route.continue();
  });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(title).toHaveValue("Unfinished private draft");
  expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
  expect(await header?.evaluate((element) => element.isConnected)).toBe(true);
  expect(await page.locator(".app-header").boundingBox()).toEqual(before);
  fail = true;
  held.release();
  await expect(page.getByRole("alert")).toContainText(
    "Could not refresh your session",
  );
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(title).toHaveValue("Unfinished private draft");
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(title).toHaveValue("Unfinished private draft");
});

test("logout discards private drafts immediately even while the request is held", async ({
  page,
}) => {
  await account(page);
  await page.goto("/bookmarks/new");
  await page
    .getByLabel("Title", { exact: true })
    .fill("Private draft to discard");
  const held = gate();
  await page.route("**/api/auth/sign-out", async (route) => {
    await held.promise;
    await route.continue();
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Signing out..." }),
  ).toBeDisabled();
  await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("progressbar", { name: "Signing out" }),
  ).toBeVisible();
  held.release();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByText("Private draft to discard")).toHaveCount(0);
});

test("an expired identity with failed reconciliation does not become visitor reset navigation", async ({
  page,
}) => {
  await account(page);
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Account Settings" }),
  ).toBeVisible();
  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({ status: 503, json: { code: "SESSION_UNAVAILABLE" } }),
  );
  await page.evaluate(() => {
    window.history.pushState({}, "", "/reset-password?token=unknown");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByRole("heading", { name: "New password", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("links:unauthorized")),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Please check your connection",
  );
  await expect(
    page.getByRole("link", { name: "Back to sign in", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
});

for (const boundary of [
  "another identity",
  "rotated session",
  "revoked session",
] as const) {
  test(`refetch discards the old page across ${boundary}`, async ({ page }) => {
    const email = await account(page);
    await page.goto("/bookmarks/new");
    const title = page.getByLabel("Title", { exact: true });
    await title.fill("Sensitive draft from old session");
    const node = await title.elementHandle();
    if (boundary === "another identity") await account(page);
    else {
      const response = await page.request.post(
        boundary === "rotated session"
          ? "/api/auth/sign-in/email"
          : "/api/auth/sign-out",
        {
          headers: { Origin: origin },
          data: boundary === "rotated session" ? { email, password } : {},
        },
      );
      expect(response.ok()).toBe(true);
    }
    await Promise.all([
      page.waitForResponse("**/api/auth/get-session**"),
      page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      ),
    ]);
    await expect
      .poll(() => node?.evaluate((element) => element.isConnected))
      .toBe(false);
    if (boundary === "revoked session") {
      await expect(page).toHaveURL(/\/login\?next=/);
      await expect(title).toHaveCount(0);
    } else await expect(title).toHaveValue("");
    await expect(page.getByRole("progressbar")).toHaveCount(0);
  });
}
