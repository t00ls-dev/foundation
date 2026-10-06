import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { z } from "zod";
import { extractEmailUrl } from "../test/email-link.js";

const password = "correct-horse-battery-staple";
function email() {
  return `links-${crypto.randomUUID()}@example.com`;
}

async function verify(request: APIRequestContext, address: string) {
  const response = await request.get(
    `/__test/mail?email=${encodeURIComponent(address)}`,
  );
  expect(response.ok()).toBe(true);
  const message = z
    .object({
      text: z
        .string()
        .transform((text) => extractEmailUrl(text, "http://127.0.0.1:5174")),
    })
    .parse(await response.json());
  return message.text;
}

async function signUp(page: Page, address: string) {
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Links Reader");
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await page.goto(await verify(page.request, address));
  await expect(
    page.getByRole("heading", { name: "Email verified" }),
  ).toBeVisible();
  await signIn(page, address);
}
async function signIn(page: Page, address: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
}
async function addBookmark(page: Page, title: string) {
  await page.getByRole("link", { name: "Add bookmark", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("URL", { exact: true })
    .fill("https://example.com/reference");
  await page
    .getByLabel("Description (optional)", { exact: true })
    .fill("Private reference");
  await page
    .getByLabel("Tags (comma-separated)", { exact: true })
    .fill("Docs, Work");
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(
    page.getByRole("article", { name: title, exact: true }),
  ).toBeVisible();
}

test("shows Google only on anonymous login/signup when server capability is enabled", async ({
  page,
}) => {
  const google = page.getByRole("button", { name: "Continue with Google" });
  for (const path of ["/login", "/signup"]) {
    await Promise.all([page.waitForResponse("**/api/config"), page.goto(path)]);
    await expect(page.getByText("Loading sign-in options...")).toHaveCount(0);
    await expect(google).toHaveCount(0);
    await expect(page.locator(".google-sign-in")).toHaveCount(0);
    await expect(page.getByRole("separator", { name: "or" })).toHaveCount(0);
  }
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { googleEnabled: true, turnstile: { status: "disabled" } },
    }),
  );
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    await expect(google).toBeVisible();
    await expect(google).toHaveAttribute("type", "button");
    await expect(google).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(google.locator("img")).toHaveAttribute("alt", "");
  }
  for (const path of [
    "/magic-link",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
  ]) {
    await page.goto(path);
    await expect(page.locator(".auth-page")).toBeVisible();
    await expect(google).toHaveCount(0);
  }
  await signUp(page, email());
  await expect(google).toHaveCount(0);
});

test("keeps exactly one Google button across repeated SPA auth mode switches", async ({
  page,
}) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { googleEnabled: true, turnstile: { status: "disabled" } },
    }),
  );
  await page.goto("/login");
  const google = page.getByRole("button", { name: "Continue with Google" });
  async function expectSingleGoogle(submitLabel: string) {
    const form = page.locator(".auth-page form");
    await expect(form).toHaveCount(1);
    await expect(
      form.getByRole("button", { name: "Continue with Google" }),
    ).toBeEnabled();
    await expect(google).toHaveCount(1);
    await expect(form.getByRole("separator", { name: "or" })).toHaveCount(1);
    // Prove containment and DOM order, not just matching colors or screen coordinates.
    await expect(
      form.locator(
        'button[type="submit"], [role="separator"], button[type="button"]',
      ),
    ).toHaveText([submitLabel, "or", "Continue with Google"]);
  }
  await expectSingleGoogle("Sign in");
  for (let round = 0; round < 12; round++) {
    await page
      .getByRole("navigation", { name: "Authentication options" })
      .getByRole("link", { name: "Create account", exact: true })
      .click();
    await expect(page).toHaveURL(/\/signup$/);
    await expectSingleGoogle("Create account");
    await page
      .getByRole("navigation", { name: "Authentication options" })
      .getByRole("link", { name: "Sign in", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    await expectSingleGoogle("Sign in");
  }
  for (const name of ["Use a magic link", "Forgot password?"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.locator(".auth-page form")).toBeVisible();
    await expect(google).toHaveCount(0);
    await expect(page.getByRole("separator", { name: "or" })).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Authentication options" })
      .getByRole("link", { name: "Sign in", exact: true })
      .click();
    await expectSingleGoogle("Sign in");
  }
});

test("loads auth capability with explicit error/retry and never treats unknown Turnstile as disabled", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  let fail = true;
  await page.route("**/api/config", async (route) => {
    attempts++;
    if (fail) {
      await held;
      await route
        .fulfill({
          status: 503,
          json: { error: { message: "sensitive configuration details" } },
        })
        .catch(() => undefined); // StrictMode may have canceled the first mount.
    } else
      await route.fulfill({
        json: { googleEnabled: true, turnstile: { status: "disabled" } },
      });
  });
  await page.goto("/login");
  await expect(page.locator(".auth-page form")).toBeVisible();
  await expect(page.locator(".google-sign-in")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
  release();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not load authentication settings. Please try again.",
  );
  await expect(page.getByRole("button", { name: /^Retry/ })).toHaveCount(1);
  await expect(page.getByText("sensitive configuration details")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "Use a magic link" }),
  ).toBeVisible();
  const beforeRetry = attempts;
  fail = false;
  await page
    .getByRole("button", { name: "Retry authentication settings" })
    .click();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  expect(attempts).toBeGreaterThan(beforeRetry);
});

test("guards double Google clicks, sanitizes initiation errors and retries using the Better Auth redirect", async ({
  page,
}) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { googleEnabled: true, turnstile: { status: "disabled" } },
    }),
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: unknown[] = [];
  let releaseRedirect!: () => void;
  const heldRedirect = new Promise<void>((resolve) => {
    releaseRedirect = resolve;
  });
  await page.route("**/api/auth/sign-in/social", async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      await held;
      await route.fulfill({
        status: 500,
        json: { message: "state=secret-token&error_description=unsafe" },
      });
    } else {
      await heldRedirect;
      await route.fulfill({
        json: { redirect: true, url: "http://127.0.0.1:5174/__oauth-ui-test" },
      });
    }
  });
  await page.route("**/__oauth-ui-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>OAuth navigation test only</h1>",
    }),
  );
  await page.goto("/login");
  const google = page.getByRole("button", { name: "Continue with Google" });
  await expect(google).toBeEnabled();
  await expect(google.locator("img")).toBeVisible();
  const idleIcon = await google.locator(".oauth-button-icon").boundingBox();
  const idleButton = await google.boundingBox();
  await google.evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
  });
  await expect(google).toBeDisabled();
  await expect(google).toHaveAttribute("aria-busy", "true");
  await expect(google).toHaveText("Continue with Google");
  await expect(google).toHaveAccessibleName("Continue with Google");
  await expect(google.locator("img")).toHaveCount(0);
  const spinner = google.locator(".oauth-spinner");
  await expect(spinner).toBeVisible();
  expect(await google.boundingBox()).toEqual(idleButton);
  expect(await google.locator(".oauth-button-icon").boundingBox()).toEqual(
    idleIcon,
  );
  await expect(google.locator(".oauth-button-icon")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.getByText("Redirecting to Google...")).toHaveCount(0);
  await expect(page.locator(".google-sign-in p")).toHaveCount(0);
  await expect(spinner).toHaveCSS("animation-name", "oauth-spin");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(spinner).toHaveCSS("animation-name", "none");
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    provider: "google",
    callbackURL: "/bookmarks",
    newUserCallbackURL: "/bookmarks",
    errorCallbackURL: "/login?oauth=failed",
  });
  release();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not sign in with Google. Please try again.",
  );
  await expect(
    page.getByText("state=secret-token&error_description=unsafe"),
  ).toHaveCount(0);
  await expect(google).toBeEnabled();
  await google.focus();
  await expect(google).toHaveAttribute("aria-busy", "false");
  await expect(google).toHaveText("Continue with Google");
  await expect(google.locator("img")).toBeVisible();
  await expect(spinner).toHaveCount(0);
  await expect(google).toBeFocused();
  await google.press("Enter");
  await expect(google).toBeDisabled();
  await expect(spinner).toBeVisible();
  await expect(google).toHaveText("Continue with Google");
  await expect(page.locator(".google-sign-in p")).toHaveCount(0);
  await expect(page.getByText("Redirecting to Google...")).toHaveCount(0);
  releaseRedirect();
  await expect(page).toHaveURL(/\/__oauth-ui-test$/);
  expect(requests).toHaveLength(2);
});

test("handles sanitized Google cancellation and clears pending on a persisted Back event", async ({
  page,
}) => {
  let capabilityRequests = 0;
  await page.route("**/api/config", (route) => {
    capabilityRequests++;
    return route.fulfill({
      json: { googleEnabled: true, turnstile: { status: "disabled" } },
    });
  });
  await page.goto(
    "/login?oauth=failed&error=access_denied&error_description=unsafe-reflected-text&state=secret-state",
  );
  await expect(page.getByRole("alert")).toHaveText(
    "Google sign-in was canceled.",
  );
  await expect(page.getByText("unsafe-reflected-text")).toHaveCount(0);
  await page.goto(
    "/login?oauth=failed&error=unknown&error_description=unsafe-reflected-text",
  );
  await expect(page.getByRole("alert")).toHaveText(
    "Could not sign in with Google. Please try again.",
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/sign-in/social", async (route) => {
    await held;
    await route
      .fulfill({ status: 500, json: { message: "not rendered" } })
      .catch(() => undefined);
  });
  const google = page.getByRole("button", { name: "Continue with Google" });
  await expect(google).toBeEnabled();
  await google.click();
  await expect(google).toBeDisabled();
  await expect(google.locator(".oauth-spinner")).toBeVisible();
  await expect(google.locator("img")).toHaveCount(0);
  await expect(google).toHaveText("Continue with Google");
  await expect(page.getByText("Redirecting to Google...")).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const beforeRestore = capabilityRequests;
  // Exercise our lifecycle handling deterministically; browser BFCache eligibility varies.
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(google).toBeEnabled();
  release();
  await expect(google).toHaveAttribute("aria-busy", "false");
  await expect(google.locator("img")).toBeVisible();
  await expect(google.locator(".oauth-spinner")).toHaveCount(0);
  await expect.poll(() => capabilityRequests).toBeGreaterThan(beforeRestore);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Redirecting to Google...")).toHaveCount(0);
});

test("verifies email, persists session and performs CRUD with filters", async ({
  page,
}) => {
  const address = email();
  await signUp(page, address);
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toBeVisible();
  await addBookmark(page, "Foundation reference");
  await page.reload();
  const article = page.getByRole("article", {
    name: "Foundation reference",
    exact: true,
  });
  await expect(article).toBeVisible();
  await article.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Updated reference");
  await page.getByRole("button", { name: "Save bookmark" }).click();
  const titleOnly = page.getByRole("article", {
    name: "Updated reference",
    exact: true,
  });
  await expect(titleOnly.getByRole("list", { name: "Tags" })).toContainText(
    "docs",
  );
  await expect(titleOnly.getByRole("list", { name: "Tags" })).toContainText(
    "work",
  );
  await titleOnly.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByLabel("Description (optional)").fill("Updated description");
  await page.getByLabel("Tags (comma-separated)").fill("Personal");
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(
    page.getByRole("article", { name: "Updated reference", exact: true }),
  ).toContainText("Updated description");
  await page.getByLabel("Filter by tag", { exact: true }).fill("docs");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No matching bookmarks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Search", { exact: true }).fill("Updated");
  await page.getByLabel("Filter by tag", { exact: true }).fill("PERSONAL");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const updated = page.getByRole("article", {
    name: "Updated reference",
    exact: true,
  });
  await expect(updated).toBeVisible();
  await updated.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete bookmark", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No matching bookmarks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.goto("/bookmarks/new");
  await expect(page).toHaveURL(/\/login\?next=%2Fbookmarks%2Fnew$/);
  expect((await page.request.get("/api/bookmarks")).status()).toBe(401);
  await signIn(page, address);
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toBeVisible();
});

test("isolates two browser users and refuses direct access to another user's bookmark", async ({
  page,
  browser,
}) => {
  await signUp(page, email());
  await addBookmark(page, "Only for A");
  const editLink = await page
    .getByRole("article", { name: "Only for A" })
    .getByRole("link", { name: "Edit" })
    .getAttribute("href");
  const id = editLink!.split("/")[2]!;
  const contextB = await browser.newContext({
    baseURL: "http://127.0.0.1:5174",
  });
  try {
    const b = await contextB.newPage();
    await signUp(b, email());
    await expect(
      b.getByRole("heading", { name: "No bookmarks yet" }),
    ).toBeVisible();
    for (const response of [
      await b.request.get(`/api/bookmarks/${id}`),
      await b.request.patch(`/api/bookmarks/${id}`, {
        data: { title: "Stolen" },
        headers: { Origin: "http://127.0.0.1:5174" },
      }),
      await b.request.delete(`/api/bookmarks/${id}`, {
        headers: { Origin: "http://127.0.0.1:5174" },
      }),
    ])
      expect(response.status()).toBe(404);
    await b.goto(editLink!);
    await expect(b.getByRole("alert")).toHaveText("Bookmark not found");
    await page.reload();
    await expect(
      page.getByRole("article", { name: "Only for A" }),
    ).toBeVisible();
  } finally {
    await contextB.close();
  }
});

test("announces auth pending, server errors and focused field validation", async ({
  page,
}) => {
  await page.goto("/reference/route");
  await expect(page).toHaveURL(/\/$/);
  await page
    .getByRole("navigation", { name: "Account navigation" })
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter a valid email address",
  );
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Invalid credentials" }),
    });
  });
  await page.getByLabel("Email", { exact: true }).fill("person@example.com");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Signing in…" }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText("Invalid credentials");
});

test("handles library loading, errors, retries, mutation failures and session expiry", async ({
  page,
  request,
}) => {
  await signUp(page, email());
  await addBookmark(page, "Error states");
  let failList = true;
  await page.route("**/api/bookmarks?**", async (route) => {
    if (failList) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Unavailable" } }),
      });
    } else await route.continue();
  });
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Loading bookmarks...");
  await expect(page.getByRole("alert")).toContainText(
    "Could not load your bookmarks",
  );
  failList = false;
  await page.getByRole("button", { name: "Try again" }).click();
  const item = page.getByRole("article", { name: "Error states" });
  await expect(item).toBeVisible();
  await item.getByRole("link", { name: "Edit", exact: true }).click();
  await page.route("**/api/bookmarks/*", async (route) => {
    if (route.request().method() === "PATCH") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Could not save" } }),
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(page.getByRole("button", { name: "Saving..." })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText("Could not save");
  await page.unroute("**/api/bookmarks/*");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(item).toBeVisible();
  const cookie = (await page.context().cookies())
    .map((value) => `${value.name}=${value.value}`)
    .join("; ");
  await request.post("/api/auth/sign-out", {
    data: {},
    headers: { Origin: "http://127.0.0.1:5174", Cookie: cookie },
  });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("requires email verification and keeps service routes outside the SPA", async ({
  page,
  request,
}) => {
  const address = email();
  const credentials = { email: address, password };
  const signup = await request.post("/api/auth/sign-up/email", {
    data: { ...credentials, name: "Unverified" },
    headers: { Origin: "http://127.0.0.1:5174" },
  });
  expect(signup.ok()).toBe(true);
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        data: credentials,
        headers: { Origin: "http://127.0.0.1:5174" },
      })
    ).status(),
  ).toBe(403);
  await page.goto("/verify-email?error=TOKEN_EXPIRED");
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  const health = await request.get("/health");
  expect(health.ok()).toBe(true);
  expect(health.headers()["cache-control"]).toBe("no-store");
  expect(await health.json()).toEqual({
    status: "ok",
    checks: { worker: "ok", database: "ok" },
  });
  const session = await request.get("/api/auth/get-session");
  expect(session.headers()["cache-control"]).toBe("private, no-store");
  const missing = await request.get("/api/missing");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "Not found" });
});

test("discards delayed private responses after logout and account switching", async ({
  page,
}) => {
  await signUp(page, email());
  await addBookmark(page, "A secret bookmark");
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/bookmarks?**", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    started();
    await pending;
    // The browser may already have aborted this request on logout.
    await route.fulfill({ response, body }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await ready;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByText("A secret bookmark", { exact: true }),
  ).toHaveCount(0);
  await signUp(page, email());
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toBeVisible();
  await expect(
    page.getByText("A secret bookmark", { exact: true }),
  ).toHaveCount(0);
});

test("shows session loading and recoverable session errors", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unavailable" }),
    });
  });
  await page.goto("/bookmarks");
  await expect(
    page.getByRole("progressbar", { name: "Loading session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Unable to load your session" }),
  ).toBeVisible();
  await page.unroute("**/api/auth/get-session");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("paginates a private library with limit and offset", async ({ page }) => {
  await signUp(page, email());
  for (let index = 0; index < 21; index++) {
    const response = await page.request.post("/api/bookmarks", {
      data: { title: `Bookmark ${index}`, url: `https://example.com/${index}` },
      headers: { Origin: "http://127.0.0.1:5174" },
    });
    expect(response.status()).toBe(201);
  }
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(20);
  await expect(
    page.getByRole("button", { name: "Previous", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(20);
});

test("keeps B authenticated when A's pending mutation returns 401", async ({
  page,
  request,
}) => {
  const b = email();
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        data: { email: b, password, name: "User B" },
        headers: { Origin: "http://127.0.0.1:5174" },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.get(await verify(request, b))).ok()).toBe(true);
  await signUp(page, email());
  await addBookmark(page, "Only A");
  await page
    .getByRole("article", { name: "Only A" })
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/bookmarks/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    started();
    await pending;
    await route
      .fulfill({
        status: 401,
        contentType: "application/json",
        headers: {
          "Set-Cookie":
            "better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
        },
        body: JSON.stringify({ error: { message: "Expired A" } }),
      })
      .catch(() => undefined); // Logout already aborted this obsolete transport.
  });
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await ready;
  const abortedA = page.waitForEvent(
    "requestfailed",
    (request) => request.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await abortedA;
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  // SPA navigation only: a page reload would cancel A's pending fetch and mask the race.
  await page.getByLabel("Email", { exact: true }).fill(b);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
  await expect(page.getByText("User B", { exact: true })).toBeVisible();
  release();
  await page.unrouteAll({ behavior: "wait" });
  // A fresh B request confirms the session and screen remain usable after the old response.
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toBeVisible();
  await expect(page.getByText("User B", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/bookmarks")).status()).toBe(200);
});
