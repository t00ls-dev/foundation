import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { totp } from "../test/totp-harness.js";

// Enrollment fixtures contain ephemeral secrets: no persisted browser traces/video.
test.use({ trace: "off", video: "off", screenshot: "off" });
const origin = "http://127.0.0.1:5174";
const password = "correct-horse-battery-staple";
const identity = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    twoFactorEnabled: z.boolean(),
  }),
  session: z.object({ id: z.string() }),
});
const settings = (page: Page) =>
  page
    .getByRole("region", { name: "Authenticator settings" })
    .or(page.getByRole("dialog"));
const signIn = (page: Page) =>
  page.getByRole("form", { name: "Sign in", exact: true });

async function mail(page: Page, email: string, subject: string) {
  const response = await page.request.get(
    `/__test/mail?email=${encodeURIComponent(email)}&subject=${encodeURIComponent(subject)}`,
  );
  return z.object({ text: z.string() }).parse(await response.json()).text;
}
async function reader(page: Page) {
  const email = `totp-ui-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { email, name: "TOTP Reader", password },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await page.request.get(await mail(page, email, "Verify your email"))).ok(),
  ).toBe(true);
  await login(page, email);
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
  await page.goto("/account");
  await expect(
    settings(page).getByText("Password sign-in authenticator: Off", {
      exact: true,
    }),
  ).toBeVisible();
  return email;
}
async function login(page: Page, email: string, next = "/bookmarks") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await signIn(page).getByLabel("Email", { exact: true }).fill(email);
  await signIn(page).getByLabel("Password", { exact: true }).fill(password);
  await signIn(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
}
async function begin(page: Page) {
  await settings(page)
    .getByRole("button", { name: "Set up", exact: true })
    .click();
  await settings(page)
    .getByLabel("Authenticator account password")
    .fill(password);
  await settings(page)
    .getByRole("button", { name: "Continue with password" })
    .click();
  const key = settings(page).getByLabel("Setup key", { exact: true });
  await expect(key).toHaveCount(0);
  await page.getByRole("button", { name: "Can't scan? Use setup key" }).click();
  await expect(key).toBeVisible();
  const secret = await key.inputValue();
  // Construct a reference URI from the public UI key, not from database state.
  return `otpauth://totp/Links?secret=${secret}&issuer=Links&digits=6&period=30`;
}
async function confirm(page: Page, uri: string) {
  await settings(page).getByLabel("Authenticator code").fill(totp(uri));
  await settings(page).getByRole("button", { name: "Confirm code" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    settings(page).getByText("Password sign-in authenticator: On", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Setup key", { exact: true })).toHaveCount(0);
}
async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(signIn(page)).toBeVisible();
}
function wrongCode(uri: string) {
  const codes = [-1, 0, 1].map((offset) => totp(uri, offset));
  return ["000000", "111111", "222222", "333333"].find(
    (code) => !codes.includes(code),
  )!;
}

test("enrolls with a local QR, confirms authoritative rotation, challenges password login and disables with password", async ({
  page,
}) => {
  const email = await reader(page);
  const before = identity.parse(
    await (await page.request.get("/api/auth/get-session")).json(),
  );
  const uri = await begin(page);
  const image = settings(page).getByRole("img", {
    name: "Authenticator setup QR code",
  });
  await expect(image).toBeVisible();
  expect(
    (await image.getAttribute("src"))?.startsWith("data:image/png;base64,"),
  ).toBe(true);
  await expect(
    page.getByRole("region", {
      name: "Authenticator settings",
      includeHidden: true,
    }),
  ).toContainText("password sign-in only");
  const secret = new URL(uri).searchParams.get("secret")!;
  const persisted = await page.evaluate(() =>
    JSON.stringify([
      localStorage,
      sessionStorage,
      history.state,
      location.href,
    ]),
  );
  expect(persisted.includes(secret)).toBe(false);
  let confirms = 0;
  let trusted = false;
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    confirms++;
    trusted ||= z
      .object({ trustDevice: z.boolean() })
      .parse(route.request().postDataJSON()).trustDevice;
    await route.continue();
  });
  await settings(page).getByLabel("Authenticator code").fill(wrongCode(uri));
  await settings(page).getByRole("button", { name: "Confirm code" }).click();
  await expect(settings(page).getByRole("alert")).toContainText(
    "incorrect or expired",
  );
  await confirm(page, uri);
  expect(confirms).toBe(2);
  expect(trusted).toBe(false);
  const after = identity.parse(
    await (await page.request.get("/api/auth/get-session")).json(),
  );
  expect(after.user.id === before.user.id).toBe(true);
  expect(after.session.id === before.session.id).toBe(false);
  await signOut(page);
  await login(page, email, "/bookmarks/new");
  await expect(page).toHaveURL(/\/two-factor\?next=%2Fbookmarks%2Fnew$/);
  expect((await page.request.get("/api/bookmarks")).status()).toBe(401);
  await expect(
    page.getByRole("link", { name: "Account", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Authenticator code").fill(totp(uri));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByRole("heading", { name: "Add bookmark" }),
  ).toBeVisible();
  await page.goto("/account");
  await settings(page)
    .getByRole("button", { name: "Turn off", exact: true })
    .click();
  await settings(page)
    .getByLabel("Authenticator account password")
    .fill(password);
  await settings(page)
    .getByRole("button", { name: "Turn off with password" })
    .click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    settings(page).getByText("Password sign-in authenticator: Off", {
      exact: true,
    }),
  ).toBeVisible();
  await signOut(page);
  await login(page, email);
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
});

test("clears setup on cancel/navigation and reflows at 320px without secret storage or third-party QR requests", async ({
  page,
}) => {
  await reader(page);
  await page.setViewportSize({ width: 320, height: 900 });
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  const first = await begin(page);
  await expect(
    settings(page).getByRole("img", { name: "Authenticator setup QR code" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await settings(page)
    .getByRole("button", { name: "Cancel authenticator setup" })
    .click();
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
  const second = await begin(page);
  expect(first === second).toBe(false);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Bookmarks", exact: true }).click();
  await page.goto("/account");
  await expect(
    settings(page).getByRole("button", {
      name: "Set up",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
  expect(
    urls.some((url) => /^https?:/.test(url) && new URL(url).origin !== origin),
  ).toBe(false);
});

for (const [code, status, text] of [
  ["INVALID_TWO_FACTOR_COOKIE", 401, "expired, was used"],
  ["TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", 400, "exhausted its attempts"],
  ["ACCOUNT_TEMPORARILY_LOCKED", 429, "temporarily locked"],
] as const) {
  test(`separates ${code} from an indeterminate outcome and preserves alternatives/next`, async ({
    page,
  }) => {
    const email = await reader(page);
    const uri = await begin(page);
    await confirm(page, uri);
    await signOut(page);
    await login(page, email, "/account");
    await expect(
      page.getByRole("button", { name: "Verify code" }),
    ).toBeVisible();
    let calls = 0;
    await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
      calls++;
      await route.fulfill({
        status,
        json: { code, message: "UNTRUSTED_REMOTE_DETAIL" },
      });
    });
    await page.getByLabel("Authenticator code").fill(totp(uri));
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.getByRole("alert")).toContainText(text);
    await expect(page.getByRole("button", { name: "Verify code" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("link", { name: "Use Magic Link instead" }),
    ).toHaveAttribute("href", "/magic-link?next=%2Faccount");
    expect(calls).toBe(1);
    expect(
      (await page.locator("body").innerText()).includes(
        "UNTRUSTED_REMOTE_DETAIL",
      ),
    ).toBe(false);
  });
}

test("handles lost confirmation response as indeterminate, clears secrets and recovers through Magic Link", async ({
  page,
}) => {
  const email = await reader(page);
  const uri = await begin(page);
  let calls = 0;
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    calls++;
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    await route.fulfill({
      status: 500,
      json: {
        code: "AUTH_STATE_INDETERMINATE",
        message: "UNTRUSTED_REMOTE_DETAIL",
      },
    });
  });
  await settings(page).getByLabel("Authenticator code").fill(totp(uri));
  await settings(page).getByRole("button", { name: "Confirm code" }).click();
  await expect(settings(page).getByRole("alert")).toContainText(
    "couldn't confirm",
  );
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
  expect(calls).toBe(1);
  await settings(page)
    .getByRole("link", { name: "Use Magic Link instead" })
    .click();
  await page
    .getByRole("form", { name: "Magic link", exact: true })
    .getByLabel("Email", { exact: true })
    .fill(email);
  await page.getByRole("button", { name: "Send link", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Magic link sent" }),
  ).toBeVisible();
  await page.goto(await mail(page, email, "Sign in"));
  await expect(
    settings(page).getByText("Last reported status: On", {
      exact: true,
    }),
  ).toBeVisible();
  expect(calls).toBe(1);
});

test("does not finish a verification against another identity and allows explicit session reconciliation", async ({
  page,
}) => {
  const email = await reader(page);
  const uri = await begin(page);
  await confirm(page, uri);
  await signOut(page);
  await login(page, email);
  await expect(page.getByRole("button", { name: "Verify code" })).toBeVisible();
  await page.route("**/api/auth/get-session?**", async (route) => {
    const response = await route.fetch();
    const data = identity.parse(await response.json());
    await route.fulfill({
      response,
      json: {
        ...data,
        user: { ...data.user, email: "another-identity@example.com" },
      },
    });
  });
  await page.getByLabel("Authenticator code").fill(totp(uri));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("alert")).toContainText("couldn't confirm");
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toHaveCount(0);
  await page.unroute("**/api/auth/get-session?**");
  await page.getByRole("button", { name: "Check current session" }).click();
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
});

test("rejects a refreshed challenge without identity context instead of trusting the cookie alone", async ({
  page,
}) => {
  const email = await reader(page);
  const uri = await begin(page);
  await confirm(page, uri);
  await signOut(page);
  await login(page, email);
  await expect(page.getByRole("button", { name: "Verify code" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Start a new password sign-in",
  );
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
});

test("recovers interrupted setup through password-protected URI retrieval without auto-retrying verification", async ({
  page,
}) => {
  await reader(page);
  const uri = await begin(page);
  let attempts = 0;
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    attempts++;
    await route.fulfill({
      status: 500,
      json: { code: "AUTH_STATE_INDETERMINATE" },
    });
  });
  await settings(page).getByLabel("Authenticator code").fill(totp(uri));
  await settings(page).getByRole("button", { name: "Confirm code" }).click();
  await expect(settings(page).getByRole("alert")).toContainText(
    "couldn't confirm",
  );
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
  expect(attempts).toBe(1);
  await page.unroute("**/api/auth/two-factor/verify-totp");
  await settings(page)
    .getByRole("button", { name: "Finish interrupted setup", exact: true })
    .click();
  await settings(page)
    .getByLabel("Authenticator account password")
    .fill(password);
  await settings(page)
    .getByRole("button", { name: "Continue with password" })
    .click();
  await page.getByRole("button", { name: "Can't scan? Use setup key" }).click();
  await expect(settings(page).getByLabel("Setup key")).toBeVisible();
  expect(
    (await settings(page).getByLabel("Setup key").inputValue()) ===
      new URL(uri).searchParams.get("secret"),
  ).toBe(true);
  await confirm(page, uri);
});

test("suppresses a late confirmation after logout and another identity signs in", async ({
  page,
}) => {
  const a = await reader(page);
  const uri = await begin(page);
  let release!: () => void;
  let started!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    started();
    await hold;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await settings(page).getByLabel("Authenticator code").fill(totp(uri));
  await settings(page).getByRole("button", { name: "Confirm code" }).click();
  await committed;
  await page.keyboard.press("Escape");
  await signOut(page);
  const b = await reader(page);
  expect(a === b).toBe(false);
  release();
  await expect(
    settings(page).getByText("Password sign-in authenticator: Off", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
  const resolved = identity.parse(
    await (await page.request.get("/api/auth/get-session")).json(),
  );
  expect(resolved.user.email === b).toBe(true);
});

test("never announces password sign-in with an incomplete challenge configuration", async ({
  page,
}) => {
  const email = await reader(page);
  const uri = await begin(page);
  await confirm(page, uri);
  await signOut(page);
  await page.route("**/api/auth/sign-in/email", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { twoFactorRedirect: true, twoFactorMethods: [] },
    });
  });
  await login(page, email);
  await expect(page.getByRole("alert")).toContainText("setup is incomplete");
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
  expect((await page.request.get("/api/bookmarks")).status()).toBe(401);
});

test("keeps rate-limited and incorrect codes retryable but stops uncertain network outcomes", async ({
  page,
}) => {
  const email = await reader(page);
  const uri = await begin(page);
  await confirm(page, uri);
  await signOut(page);
  await login(page, email);
  await expect(page.getByRole("button", { name: "Verify code" })).toBeVisible();
  let calls = 0;
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    calls++;
    if (calls === 1)
      await route.fulfill({
        status: 429,
        json: { message: "UNTRUSTED_RATE_DETAIL" },
      });
    else if (calls === 2)
      await route.fulfill({ status: 401, json: { code: "INVALID_CODE" } });
    else await route.abort();
  });
  for (const message of [
    "Wait before trying again",
    "incorrect or expired",
    "couldn't confirm",
  ]) {
    await page.getByLabel("Authenticator code").fill(totp(uri));
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.getByRole("alert")).toContainText(message);
  }
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
  expect(calls).toBe(3);
});

test("requires the account password and guards duplicate enrollment submits with focused validation", async ({
  page,
}) => {
  await reader(page);
  let calls = 0;
  await page.route("**/api/auth/two-factor/enable", async (route) => {
    calls++;
    await route.continue();
  });
  await settings(page)
    .getByRole("button", { name: "Set up", exact: true })
    .click();
  const button = settings(page).getByRole("button", {
    name: "Continue with password",
  });
  const field = settings(page).getByLabel("Authenticator account password");
  await button.click();
  await expect(field).toBeFocused();
  expect(calls).toBe(0);
  await field.fill("wrong-password");
  await button.click();
  await expect(settings(page).getByRole("alert")).toContainText(
    "Current password is incorrect",
  );
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
  await field.fill(password);
  await button.evaluate((element) => {
    if (element instanceof HTMLButtonElement) {
      element.click();
      element.click();
    }
  });
  await page.getByRole("button", { name: "Can't scan? Use setup key" }).click();
  await expect(page.getByLabel("Setup key")).toBeVisible();
  expect(calls).toBe(2);
  await expect(page.getByLabel("Authenticator account password")).toHaveCount(
    0,
  );
  await settings(page).getByLabel("Authenticator code").fill("123");
  await settings(page).getByRole("button", { name: "Confirm code" }).click();
  await expect(settings(page).getByLabel("Authenticator code")).toBeFocused();
  await expect(settings(page).getByRole("alert")).toContainText("six-digit");
});

test("keeps verification closed if the final identity read fails across the authenticated route remount", async ({
  page,
}) => {
  const email = await reader(page);
  const uri = await begin(page);
  await confirm(page, uri);
  await signOut(page);
  await login(page, email);
  await expect(page.getByRole("button", { name: "Verify code" })).toBeVisible();
  let reads = 0;
  let verifications = 0;
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    verifications++;
    await route.continue();
  });
  await page.route("**/api/auth/get-session?**", async (route) => {
    reads++;
    if (reads === 2)
      await route.fulfill({ status: 503, json: { code: "AUTH_FAILURE" } });
    else await route.continue();
  });
  await page.getByLabel("Authenticator code").fill(totp(uri));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(
    page.getByRole("button", { name: "Check current session" }),
  ).toBeVisible();
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
  expect(verifications).toBe(1);
  await page.getByRole("button", { name: "Check current session" }).click();
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
  expect(verifications).toBe(1);
});

test("normal Off and On never expose recovery and unknown never becomes Off", async ({
  page,
}) => {
  await reader(page);
  await expect(
    page.getByRole("button", { name: "Finish interrupted setup" }),
  ).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Account name" })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit name" }).click();
  await expect(
    page.getByRole("button", { name: "Change password", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Set up", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel name edit" }).click();
  const uri = await begin(page);
  await confirm(page, uri);
  await expect(
    page.getByRole("button", { name: "Turn off", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish interrupted setup" }),
  ).toHaveCount(0);
  await page.route("**/api/auth/get-session*", async (route) => {
    const response = await route.fetch();
    const data = identity.parse(await response.json());
    await route.fulfill({
      response,
      json: { ...data, user: { ...data.user, twoFactorEnabled: null } },
    });
  });
  await page.reload();
  await expect(
    page.getByText("Authenticator status: Unknown", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Password sign-in authenticator: Off", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Set up", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Turn off", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check authenticator status" }),
  ).toBeVisible();
});

test("setup key is absent while collapsed and Copy confirms only an exact successful write", async ({
  page,
}) => {
  await reader(page);
  const uri = await begin(page);
  const secret = new URL(uri).searchParams.get("secret")!;
  const reveal = page.getByRole("button", {
    name: "Can't scan? Use setup key",
  });
  await reveal.click();
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
  expect(
    await page
      .locator("body")
      .evaluate((body, value) => body.textContent?.includes(value), secret),
  ).toBe(false);
  await reveal.click();
  await page.evaluate((expected) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) =>
          value === expected
            ? Promise.resolve()
            : Promise.reject(new Error("Wrong copy")),
      },
    });
  }, secret);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Copied$/ }),
  ).toBeVisible();
  await reveal.click();
  await reveal.click();
  await expect(page.getByText("Copied", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Denied")) },
    });
  });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(
    page.getByText(
      "Couldn't copy. Select the setup key and copy it manually.",
      { exact: true },
    ),
  ).toBeVisible();
  const key = page.getByLabel("Setup key", { exact: true });
  await expect(key).toBeFocused();
  expect(
    await key.evaluate(
      (element) =>
        element instanceof HTMLInputElement &&
        element.selectionStart === 0 &&
        element.selectionEnd === element.value.length,
    ),
  ).toBe(true);
  await expect(page.getByText("Copied", { exact: true })).toHaveCount(0);
});

test("Dialog traps focus, handles Escape and returns focus; QR flow scrolls at 320px and 200%", async ({
  page,
}) => {
  await reader(page);
  const trigger = page.getByRole("button", { name: "Set up", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Set up authenticator" });
  await expect(page.getByLabel("Authenticator account password")).toBeFocused();
  await page.getByLabel("Authenticator account password").fill("discard-this");
  await page
    .getByRole("button", { name: "Cancel authenticator setup" })
    .focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Authenticator account password")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByLabel("Authenticator account password")).toHaveValue(
    "",
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 568 });
  await begin(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const content = page.getByRole("dialog");
  expect(
    await content.evaluate(
      (element) =>
        element.scrollHeight > element.clientHeight &&
        element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Cancel authenticator setup" })
    .click();
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Authenticator setup QR code" }),
  ).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("closing a pending enrollment clears local fields and keeps its outcome indeterminate", async ({
  page,
}) => {
  await reader(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/auth/two-factor/enable", async (route) => {
    started = true;
    await held;
    await route
      .fulfill({ status: 500, json: { code: "AUTH_STATE_INDETERMINATE" } })
      .catch(() => undefined);
  });
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await page.getByLabel("Authenticator account password").fill(password);
  await page.getByRole("button", { name: "Continue with password" }).click();
  await expect.poll(() => started).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(settings(page).getByRole("alert")).toContainText(
    "couldn't confirm",
  );
  await expect(page.getByLabel("Authenticator account password")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Finish interrupted setup" }),
  ).toBeVisible();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(settings(page).getByRole("alert")).toContainText(
    "couldn't confirm",
  );
});

test("unexpected turn-off stays indeterminate even after a reported Off status", async ({
  page,
}) => {
  await reader(page);
  const uri = await begin(page);
  await confirm(page, uri);
  await page.route("**/api/auth/two-factor/disable", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({
      status: 500,
      json: { code: "AUTH_STATE_INDETERMINATE" },
    });
  });
  await page.getByRole("button", { name: "Turn off", exact: true }).click();
  await page.getByLabel("Authenticator account password").fill(password);
  await page.getByRole("button", { name: "Turn off with password" }).click();
  await expect(settings(page).getByRole("alert")).toContainText(
    "couldn't confirm",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Authenticator turned off.", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Check authenticator status" })
    .click();
  await expect(settings(page).getByRole("alert")).toContainText(
    "couldn't confirm",
  );
  await expect(
    page.getByRole("button", { name: "Finish interrupted setup" }),
  ).toBeVisible();
});

test("late clipboard completion cannot announce Copied after collapse or close", async ({
  page,
}) => {
  await reader(page);
  await begin(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            (
              window as Window & { finishClipboard?: () => void }
            ).finishClipboard = resolve;
          }),
      },
    });
  });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page.getByRole("button", { name: "Can't scan? Use setup key" }).click();
  await page.evaluate(() => {
    (window as Window & { finishClipboard?: () => void }).finishClipboard?.();
  });
  await page.getByRole("button", { name: "Can't scan? Use setup key" }).click();
  await expect(page.getByText("Copied", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as Window & { finishClipboard?: () => void }).finishClipboard?.();
  });
  await expect(page.getByText("Copied", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
});

test("setup completion waits for authoritative reconciliation and cleans fields before session replacement", async ({
  page,
}) => {
  await reader(page);
  const uri = await begin(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/auth/get-session?**", async (route) => {
    started = true;
    await held;
    await route.continue();
  });
  await page.getByLabel("Authenticator code").fill(totp(uri));
  await page.getByRole("button", { name: "Confirm code" }).click();
  await expect.poll(() => started).toBe(true);
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Authenticator confirmed for password sign-in.", {
      exact: true,
    }),
  ).toHaveCount(0);
  release();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByLabel("Setup key")).toHaveCount(0);
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
  await expect(
    settings(page).getByText("Password sign-in authenticator: On", {
      exact: true,
    }),
  ).toBeVisible();
});

test("an observed incomplete verification keeps Account recovery contextual after Magic Link sign-in", async ({
  page,
}) => {
  const email = await reader(page);
  const uri = await begin(page);
  await confirm(page, uri);
  await signOut(page);
  await login(page, email, "/account");
  await expect(page.getByRole("button", { name: "Verify code" })).toBeVisible();
  await page.route("**/api/auth/two-factor/verify-totp", (route) =>
    route.fulfill({ status: 400, json: { code: "TOTP_NOT_ENABLED" } }),
  );
  await page.getByLabel("Authenticator code").fill(totp(uri));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "setup needs to be checked",
  );
  await page.getByRole("link", { name: "Use Magic Link instead" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send link", exact: true }).click();
  await expect(
    page.getByText("Magic link sent", { exact: true }),
  ).toBeVisible();
  await page.goto(await mail(page, email, "Sign in"));
  await expect(
    page.getByRole("button", { name: "Finish interrupted setup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set up", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Edit name" }).click();
  await expect(
    page.getByRole("button", { name: "Finish interrupted setup" }),
  ).toBeDisabled();
  await signOut(page);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("links:authenticator-recovery"),
    ),
  ).toBeNull();
  await reader(page);
  await expect(
    page.getByRole("button", { name: "Finish interrupted setup" }),
  ).toHaveCount(0);
});
