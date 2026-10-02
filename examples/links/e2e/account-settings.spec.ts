import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

const origin = "http://127.0.0.1:5174";
const password = "correct-horse-battery-staple";
const unconfirmed =
  "We couldn't confirm whether your name was saved. Reload Account to check before trying again.";
const sessionSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  session: z.object({ id: z.string() }),
});
async function mail(page: Page, email: string, subject: string) {
  const response = await page.request.get(
    `/__test/mail?${new URLSearchParams({ email, subject })}`,
  );
  expect(response.ok()).toBe(true);
  return z.object({ text: z.string().url() }).parse(await response.json()).text;
}
async function account(page: Page, name = "Existing Reader") {
  const email = `account-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { email, name, password },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await page.request.get(await mail(page, email, "Verify your email"))).ok(),
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
async function session(page: Page) {
  const response = await page.request.get(
    "/api/auth/get-session?disableCookieCache=true",
  );
  return sessionSchema.parse(await response.json());
}

test("Account protects its canonical route and redirects legacy deep links without duplicating the page", async ({
  page,
}) => {
  for (const path of ["/account", "/account/security"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
    await expect(
      page.getByRole("heading", { name: "Account Settings" }),
    ).toHaveCount(0);
  }
  await account(page);
  await page.goto("/account/security?source=old#security");
  await expect(page).toHaveURL(`${origin}/account?source=old#security`);
  await expect(
    page.getByRole("heading", { name: "Account Settings" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Security", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Security", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Account", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("an empty name can be set and changed again through the official API while sessions and email are preserved", async ({
  page,
  request,
}) => {
  const email = await account(page, "");
  const before = await session(page);
  expect(before.user.name).toBe("");
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        headers: { Origin: origin },
        data: { email, password },
      })
    ).ok(),
  ).toBe(true);
  const payloads: unknown[] = [];
  await page.route("**/api/auth/update-user", async (route) => {
    payloads.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.goto("/account");
  const form = page.getByRole("form", { name: "Account name" });
  const name = form.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("");
  await expect(form.locator("dd")).toHaveText(email);
  await expect(
    page.locator('input[type="email"], input[name="email"], input:disabled'),
  ).toHaveCount(0);
  for (const next of ["  Zoë 李 Reader  ", "Second Reader"]) {
    await name.fill(next);
    const calls = payloads.length;
    await expect(form.getByRole("button", { name: "Save name" })).toBeEnabled();
    expect(payloads.length).toBe(calls);
    await form.getByRole("button", { name: "Save name" }).click();
    await expect(form.getByRole("status")).toHaveText("Name saved.");
    await expect(page.locator(".account > span")).toHaveText(next.trim());
    await expect(name).toHaveValue(next.trim());
    expect(payloads[calls]).toEqual({ name: next.trim() });
    const after = await session(page);
    expect(after.session.id).toBe(before.session.id);
    expect(after.user.id).toBe(before.user.id);
    expect(after.user.email).toBe(email);
    expect(after.user.name).toBe(next.trim());
  }
  expect((await request.get("/api/bookmarks")).status()).toBe(200);
  await page.reload();
  await expect(page.locator(".account > span")).toHaveText("Second Reader");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Second Reader",
  );
  await expect(
    page.getByRole("button", { name: "Change password", exact: true }),
  ).toBeVisible();
});

test("name validation and failures are recoverable, single-submit and never leak raw errors", async ({
  page,
  request,
}) => {
  expect(
    (
      await request.post("/api/auth/update-user", {
        headers: { Origin: origin },
        data: { name: "No session" },
      })
    ).status(),
  ).toBe(401);
  await account(page);
  await page.goto("/account");
  const form = page.getByRole("form", { name: "Account name" });
  const name = form.getByLabel("Name", { exact: true });
  await name.fill("   ");
  await form.getByRole("button", { name: "Save name" }).click();
  await expect(form.getByRole("alert")).toHaveText("Enter your name");
  await expect(name).toBeFocused();
  for (const invalid of ["", "a".repeat(201), "First\u0000Last"]) {
    const response = await page.request.post("/api/auth/update-user", {
      headers: { Origin: origin },
      data: { name: invalid },
    });
    expect(response.status()).toBe(400);
  }
  expect(
    (
      await page.request.post("/api/auth/update-user", {
        headers: { Origin: "https://evil.example" },
        data: { name: "Other" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/auth/update-user", {
        headers: { Origin: origin },
        data: { name: "Other", email: "other@example.com" },
      })
    ).status(),
  ).toBe(400);
  expect((await session(page)).user.name).toBe("Existing Reader");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/api/auth/update-user", async (route) => {
    calls++;
    await held;
    await route.fulfill({ status: 500, json: { message: "unsafe-sql/token" } });
  });
  await name.fill("Updated Reader");
  await form.evaluate((element: HTMLFormElement) => {
    element.requestSubmit();
    element.requestSubmit();
  });
  await expect(
    form.getByRole("button", { name: "Saving name..." }),
  ).toBeDisabled();
  await expect.poll(() => calls).toBe(1);
  release();
  await expect(form.getByRole("alert")).toHaveText(unconfirmed);
  await expect(page.getByText("unsafe-sql/token")).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Save name" })).toBeEnabled();
  await expect(name).toHaveValue("Updated Reader");
  await page.unroute("**/api/auth/update-user");
  await form.getByRole("button", { name: "Save name" }).click();
  await expect(form.getByRole("status")).toHaveText("Name saved.");
});

test("passwordless Account keeps Security and reflows with an editable name and informational email", async ({
  page,
}) => {
  const email = `passwordless-account-${crypto.randomUUID()}@example.com`;
  await page.goto("/magic-link");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(
    page.getByText("Magic link sent", { exact: true }),
  ).toBeVisible();
  await page.goto(await mail(page, email, "Sign in"));
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Send password link" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Name", { exact: true }).fill("Passwordless Reader");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.locator(".account > span")).toHaveText(
    "Passwordless Reader",
  );
  for (const width of [320, 375, 640, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scale of ["100%", "200%"]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, scale);
      const sizes = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(sizes[0]).toBeLessThanOrEqual(sizes[1]!);
    }
  }
});

test("a late name response cannot overwrite the next account after logout", async ({
  page,
}) => {
  const b = await account(page, "Reader B");
  await account(page, "Reader A");
  await page.goto("/account");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/update-user", async (route) => {
    await held;
    await route
      .fulfill({ status: 500, json: { message: "late error" } })
      .catch(() => undefined);
  });
  await page.getByLabel("Name", { exact: true }).fill("Old account edit");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page.getByRole("button", { name: "Saving name..." }),
  ).toBeDisabled();
  const aborted = page.waitForEvent(
    "requestfailed",
    (request) => new URL(request.url()).pathname === "/api/auth/update-user",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await aborted;
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(b);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Reader B",
  );
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.locator(".account > span")).toHaveText("Reader B");
  await expect(page.getByText(unconfirmed, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Reader B",
  );
});
