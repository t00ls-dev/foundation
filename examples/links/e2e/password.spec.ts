import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { openNavigation } from "./navigation.js";
import { extractEmailUrl } from "../test/email-link.js";

const password = "correct-horse-battery-staple";
const newPassword = "  replacement-horse-battery-staple  ";
const origin = "http://127.0.0.1:5174";
const unconfirmed =
  "We couldn't confirm whether your password change completed. Try signing in again. If needed, use password reset.";
const sessionSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
  }),
  session: z.object({ id: z.string() }),
});
function address() {
  return `security-${crypto.randomUUID()}@example.com`;
}
async function mail(page: Page, email: string, subject: string) {
  const response = await page.request.get(
    `/__test/mail?email=${encodeURIComponent(email)}&subject=${encodeURIComponent(subject)}`,
  );
  expect(response.ok()).toBe(true);
  return extractEmailUrl(
    z.object({ text: z.string() }).parse(await response.json()).text,
    origin,
  );
}
async function passwordUser(page: Page, email: string) {
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { email, name: "Security Reader", password },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.get(
        await mail(page, email, "Verify your email for Links"),
      )
    ).ok(),
  ).toBe(true);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Bookmarks", exact: true }),
  ).toBeVisible();
}
async function fillChange(
  page: Page,
  current: string,
  confirmation = newPassword,
) {
  await page.getByLabel("Current password", { exact: true }).fill(current);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(confirmation);
}

test("signup confirmation is required/matched locally and never sent to Better Auth", async ({
  page,
}) => {
  let calls = 0;
  let keys: string[] = [];
  await page.route("**/api/auth/sign-up/email", async (route) => {
    calls++;
    const body: unknown = route.request().postDataJSON();
    keys = Object.keys(z.record(z.string(), z.unknown()).parse(body)).sort();
    await route.continue();
  });
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Security Reader");
  await page.getByLabel("Email", { exact: true }).fill(address());
  await page.getByLabel("Password", { exact: true }).fill(password);
  const confirm = page.getByLabel("Confirm password", { exact: true });
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(confirm).toBeFocused();
  expect(calls).toBe(0);
  await confirm.fill("mismatched-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText("Passwords do not match");
  await expect(confirm).toBeFocused();
  expect(calls).toBe(0);
  await confirm.fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  expect(calls).toBe(1);
  expect(keys).toEqual(["callbackURL", "email", "name", "password"]);
});

test("Security protects its route and changes password with one submit and a usable replacement session", async ({
  page,
  request,
}) => {
  await page.goto("/account/security");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
  await expect(
    page.getByRole("link", { name: "Account", exact: true }),
  ).toHaveCount(0);
  const email = address();
  await passwordUser(page, email);
  const before = sessionSchema.parse(
    await (await page.request.get("/api/auth/get-session")).json(),
  );
  const oldCookie = (await page.context().cookies())
    .map((value) => `${value.name}=${value.value}`)
    .join("; ");
  const second = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email, password },
  });
  expect(second.status()).toBe(200);
  expect((await request.get("/api/bookmarks")).status()).toBe(200);
  await openNavigation(page);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Security", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeVisible();
  let calls = 0;
  let keys: string[] = [];
  let revoke = false;
  let retainedSpaces = false;
  let held = false;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/change-password", async (route) => {
    calls++;
    const body = z
      .record(z.string(), z.unknown())
      .parse(route.request().postDataJSON());
    keys = Object.keys(body).sort();
    revoke = body.revokeOtherSessions === true;
    retainedSpaces = body.newPassword === newPassword;
    if (held) await hold;
    await route.continue();
  });
  await fillChange(page, "incorrect-current-password", "mismatched-password");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText("Passwords do not match");
  await expect(
    page.getByLabel("Confirm new password", { exact: true }),
  ).toBeFocused();
  expect(calls).toBe(0);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(newPassword);
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Current password is incorrect.",
  );
  expect(calls).toBe(1);
  await fillChange(page, password);
  held = true;
  await page
    .getByRole("form", { name: "Change password" })
    .evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
  await expect(
    page.getByRole("button", { name: "Changing password..." }),
  ).toBeDisabled();
  await expect.poll(() => calls).toBe(2);
  const dialog = page.getByRole("dialog", { name: "Change password" });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  release();
  await expect(
    page.getByText("Password updated. Other sessions have been signed out.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const name of [
    "Current password",
    "New password",
    "Confirm new password",
  ])
    await expect(page.getByLabel(name, { exact: true })).toHaveCount(0);
  expect(keys).toEqual([
    "currentPassword",
    "newPassword",
    "revokeOtherSessions",
  ]);
  expect(revoke && retainedSpaces).toBe(true);
  expect(calls).toBe(2);
  const after = sessionSchema.parse(
    await (await page.request.get("/api/auth/get-session")).json(),
  );
  expect(after.user).toEqual(before.user);
  expect(after.session.id === before.session.id).toBe(false);
  expect((await request.get("/api/bookmarks")).status()).toBe(401);
  expect(
    (
      await request.get("/api/bookmarks", { headers: { Cookie: oldCookie } })
    ).status(),
  ).toBe(401);
  await page.reload();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to bookmarks" }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await openNavigation(page);
  await page
    .getByRole("navigation", { name: "Account navigation" })
    .getByRole("link", { name: "Bookmarks", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bookmarks", exact: true }),
  ).toBeVisible();
});

test("Security capability loading/error/retry is distinct from false and unexpected mutation failure is indeterminate", async ({
  page,
}) => {
  await passwordUser(page, address());
  let failed = true;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/account/security", async (route) => {
    if (failed) {
      await hold;
      await route
        .fulfill({
          status: 500,
          json: { error: { message: "unsafe-sql-details" } },
        })
        .catch(() => undefined);
    } else await route.continue();
  });
  await openNavigation(page);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Account security" })
      .locator('[data-slot="skeleton"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send password link" }),
  ).toHaveCount(0);
  release();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not load security settings. Please try again.",
  );
  await expect(page.getByText("unsafe-sql-details")).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Retry security settings" }).click();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeVisible();
  let mutations = 0;
  await page.route("**/api/auth/change-password", async (route) => {
    mutations++;
    await route.fulfill({
      status: 500,
      json: { code: "AUTH_FAILURE", message: "unsafe-token-details" },
    });
  });
  await fillChange(page, password);
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(unconfirmed);
  await expect(page.getByText("unsafe-token-details")).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "Change password" }).getByRole("link", {
      name: "Forgot password?",
    }),
  ).toBeVisible();
  for (const name of [
    "Current password",
    "New password",
    "Confirm new password",
  ])
    await expect(page.getByLabel(name, { exact: true })).toHaveValue("");
  expect(mutations).toBe(1);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Account security" }).getByRole("alert"),
  ).toContainText(unconfirmed);
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    unconfirmed,
  );
  expect(mutations).toBe(1);
});

test("a delayed password failure cannot affect Security after logout and account switching", async ({
  page,
}) => {
  await passwordUser(page, address());
  await openNavigation(page);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/change-password", async (route) => {
    await hold;
    await route
      .fulfill({
        status: 500,
        json: { code: "AUTH_FAILURE", message: "late failure" },
      })
      .catch(() => undefined);
  });
  await fillChange(page, password);
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Changing password..." }),
  ).toBeDisabled();
  // A critical dialog cannot be dismissed. An external logout still invalidates
  // the identity boundary and must discard the old outcome.
  expect(
    (
      await page.request.post("/api/auth/sign-out", {
        headers: { Origin: origin },
        data: {},
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await passwordUser(page, address());
  await openNavigation(page);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeVisible();
  release();
  await expect(page.getByText(unconfirmed, { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Change password", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeVisible();
});

test("passwordless Security sends the official email reset and confirms the first password without revoking its session", async ({
  page,
  request,
}) => {
  const email = address();
  await page.goto("/magic-link");
  await expect(page.getByLabel("Confirm password")).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Check your email for a sign-in link.", { exact: true }),
  ).toBeVisible();
  await page.goto(await mail(page, email, "Sign in to Links"));
  await expect(
    page.getByRole("heading", { name: "Bookmarks", exact: true }),
  ).toBeVisible();
  const before = sessionSchema.parse(
    await (await page.request.get("/api/auth/get-session")).json(),
  );
  await openNavigation(page);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page.getByText("Not set", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toHaveCount(0);
  let emailFromSession = false;
  let resetRequestKeys: string[] = [];
  await page.route("**/api/auth/request-password-reset", async (route) => {
    const body = z
      .record(z.string(), z.unknown())
      .parse(route.request().postDataJSON());
    emailFromSession =
      body.email === email && body.redirectTo === "/reset-password";
    resetRequestKeys = Object.keys(body).sort();
    await route.continue();
  });
  await page.getByRole("link", { name: "Set password by email" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
  await page
    .getByRole("button", { name: "Send reset link", exact: true })
    .click();
  await expect(
    page.getByText(
      "If an account exists for this email, check your inbox for a reset link.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  expect(emailFromSession).toBe(true);
  expect(resetRequestKeys).toEqual(["email", "redirectTo"]);
  await page.goto(await mail(page, email, "Reset your Links password"));
  await expect(
    page.getByRole("heading", { name: "New password", exact: true }),
  ).toBeVisible();
  let resets = 0;
  let resetKeys: string[] = [];
  await page.route("**/api/auth/reset-password", async (route) => {
    resets++;
    resetKeys = Object.keys(
      z.record(z.string(), z.unknown()).parse(route.request().postDataJSON()),
    ).sort();
    await route.continue();
  });
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("mismatched-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("alert")).toHaveText("Passwords do not match");
  await expect(
    page.getByLabel("Confirm new password", { exact: true }),
  ).toBeFocused();
  expect(resets).toBe(0);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(
    page.getByRole("heading", { name: "Password updated", exact: true }),
  ).toBeVisible();
  expect(resets).toBe(1);
  expect(resetKeys).toEqual(["newPassword", "token"]);
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("Confirm new password", { exact: true }),
  ).toHaveCount(0);
  const after = sessionSchema.parse(
    await (await page.request.get("/api/auth/get-session")).json(),
  );
  expect(after).toEqual(before);
  await openNavigation(page);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeVisible();
  const login = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email, password: newPassword },
  });
  expect(login.status()).toBe(200);
});
