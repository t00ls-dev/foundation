import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { totp } from "../test/totp-harness.js";

test.use({ trace: "off", video: "off", screenshot: "off" });
const origin = "http://127.0.0.1:5174";
const password = "correct-horse-battery-staple";
const sdk =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
async function enabled(page: Page, mode = "on") {
  await page
    .context()
    .addCookies([{ name: "links_e2e_turnstile", value: mode, url: origin }]);
  await page.route(sdk, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    window.fixtureWidgets = [];
    window.turnstile = {
      render(element, options) {
        const id = String(window.fixtureWidgets.length);
        const record = { options, removed: false };
        window.fixtureWidgets.push(record);
        const box = document.createElement('div');
        box.style.width = options.size === 'compact' ? '150px' : '100%';
        box.style.height = options.size === 'compact' ? '140px' : '65px';
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Complete fixture verification';
        button.onclick = () => options.callback('fixture:' + options.action + ':' + crypto.randomUUID());
        box.append(button); element.append(box); record.box = box;
        return id;
      },
      remove(id) { const record = window.fixtureWidgets[Number(id)]; if (record) { record.removed = true; record.box.remove(); } }
    };
  `,
    }),
  );
}
async function complete(page: Page) {
  await page
    .getByRole("button", { name: "Complete fixture verification" })
    .click();
}
async function emailLink(page: Page, email: string, subject: string) {
  return z
    .object({ text: z.string() })
    .parse(
      await (
        await page.request.get(
          `/__test/mail?${new URLSearchParams({ email, subject })}`,
        )
      ).json(),
    ).text;
}
async function user(page: Page) {
  const email = `turnstile-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { email, password, name: "Turnstile Reader" },
      })
    ).status(),
  ).toBe(200);
  await page.request.get(await emailLink(page, email, "Verify your email"));
  return email;
}

test("server protects all four requests without cookie/header bypass and checks action/reuse", async ({
  page,
}) => {
  const email = await user(page);
  await enabled(page);
  for (const path of [
    "sign-up/email",
    "sign-in/email",
    "sign-in/magic-link",
    "request-password-reset",
  ]) {
    const missing = await page.request.post(`/api/auth/${path}`, {
      headers: { "Origin": origin, "x-authenticated": "true" },
      data: {
        email,
        password,
        name: "Ignored",
        redirectTo: "/reset-password",
        callbackURL: "/account",
      },
    });
    expect(missing.status()).toBe(400);
  }
  const header = {
    "Origin": origin,
    "x-captcha-response": `fixture:links-sign-in:${crypto.randomUUID()}`,
  };
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        headers: header,
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post("/api/auth/request-password-reset", {
        headers: { Origin: origin },
        data: { email, redirectTo: "/reset-password" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        headers: header,
        data: { email, password },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/auth/request-password-reset", {
        headers: {
          "Origin": origin,
          "x-captcha-response": `fixture:links-sign-up:${crypto.randomUUID()}`,
        },
        data: { email, redirectTo: "/reset-password" },
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.get("/api/account/security")).status()).toBe(200);
});

test("widget binds all four actions, is light/centered before the primary action, and resets every attempted request", async ({
  page,
}) => {
  await enabled(page);
  await page.setViewportSize({ width: 320, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  for (const [path, action, button] of [
    ["/login", "links-sign-in", "Sign in"],
    ["/signup", "links-sign-up", "Create account"],
    ["/magic-link", "links-magic-link", "Send link"],
    ["/forgot-password", "links-password-reset", "Request reset"],
  ]) {
    await page.goto(path!);
    const primary = page.getByRole("button", { name: button!, exact: true });
    await expect(primary).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Complete fixture verification" }),
    ).toBeVisible();
    const metadata = await page.evaluate(() => {
      const records = (
        window as Window & {
          fixtureWidgets?: Array<{
            options: {
              "action": string;
              "theme": string;
              "size": string;
              "response-field": boolean;
            };
          }>;
        }
      ).fixtureWidgets!;
      return records.at(-1)!.options;
    });
    expect(metadata.action).toBe(action);
    expect(metadata.theme).toBe("light");
    expect(metadata.size).toBe("compact");
    expect(metadata["response-field"]).toBe(false);
    expect(
      await primary.evaluate((element) => {
        const widget = document
          .querySelector(".turnstile-container > div")!
          .getBoundingClientRect();
        const form = element.closest("form")!.getBoundingClientRect();
        return (
          widget.bottom <= element.getBoundingClientRect().top &&
          Math.abs(
            (widget.left + widget.right) / 2 - (form.left + form.right) / 2,
          ) < 2
        );
      }),
    ).toBe(true);
    await complete(page);
    await expect(primary).toBeEnabled();
    await page.getByLabel("Email", { exact: true }).fill("fixture@example.com");
    if (path === "/signup") {
      await page.getByLabel("Name", { exact: true }).fill("Reader");
      await page.getByLabel("Confirm password", { exact: true }).fill(password);
    }
    if (path === "/login" || path === "/signup")
      await page.getByLabel("Password", { exact: true }).fill(password);
    await page.route("**/api/auth/**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      expect(Boolean(route.request().headers()["x-captcha-response"])).toBe(
        true,
      );
      await route.fulfill({
        status: 403,
        json: { code: "VERIFICATION_FAILED", message: "untrusted" },
      });
    });
    await primary.click();
    await expect(page.getByRole("alert")).toContainText(
      "Verification failed or expired",
    );
    await expect(primary).toBeDisabled();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.unroute("**/api/auth/**");
  }
});

test("expiry/error/late callback and navigation discard token; loading failure never means disabled", async ({
  page,
}) => {
  await enabled(page);
  await page.goto("/login");
  const primary = page.getByRole("button", { name: "Sign in", exact: true });
  await complete(page);
  await page.evaluate(() => {
    const records = (
      window as Window & {
        fixtureWidgets?: Array<{ options: { "expired-callback": () => void } }>;
      }
    ).fixtureWidgets!;
    records.at(-1)!.options["expired-callback"]();
  });
  await expect(primary).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Verification expired");
  await page.evaluate(() => {
    const records = (
      window as Window & {
        fixtureWidgets?: Array<{
          options: { callback: (token: string) => void };
        }>;
      }
    ).fixtureWidgets!;
    records.at(-1)!.options.callback("fixture:links-sign-in:expired-late");
  });
  await expect(primary).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry verification", exact: true })
    .click();
  await complete(page);
  await page.getByRole("link", { name: "Use a magic link" }).click();
  const send = page.getByRole("button", { name: "Send link", exact: true });
  await expect(send).toBeDisabled();
  await page.evaluate(() => {
    const records = (
      window as Window & {
        fixtureWidgets?: Array<{
          removed: boolean;
          options: { callback: (token: string) => void };
        }>;
      }
    ).fixtureWidgets!;
    records
      .find((record) => record.removed)!
      .options.callback("fixture:links-sign-in:late");
  });
  await expect(send).toBeDisabled();
  await page.route(sdk, (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Could not load verification",
  );
  await expect(send).toBeDisabled();
});

test("pre-auth provider outage stays inline and Google remains separate; later auth failures remain indeterminate", async ({
  page,
}) => {
  const email = await user(page);
  await enabled(page);
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        googleEnabled: true,
        turnstile: { status: "enabled", siteKey: "fixture-public" },
      },
    }),
  );
  await page.goto("/login?next=%2Faccount");
  await complete(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.evaluate(() => {
    const records = (
      window as Window & {
        fixtureWidgets?: Array<{
          options: { callback: (token: string) => void };
        }>;
      }
    ).fixtureWidgets!;
    records.at(-1)!.options.callback("fixture-network");
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Verification is temporarily unavailable",
  );
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "Verify code" })).toHaveCount(
    0,
  );
  await complete(page);
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({ status: 500, json: { code: "AUTH_STATE_INDETERMINATE" } }),
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/two-factor\?next=%2Faccount$/);
  await expect(page.getByRole("alert")).toContainText("couldn't confirm");
  await expect(page.locator(".turnstile-verification")).toHaveCount(0);
});

test("valid native server verification signs in and sends magic/reset links; partial config blocks only public requests", async ({
  page,
}) => {
  const email = await user(page);
  await enabled(page);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await complete(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
  for (const [path, button, message] of [
    ["/magic-link", "Send link", "Magic link sent"],
    ["/forgot-password", "Request reset", "If the account exists"],
  ]) {
    await page.goto(path!);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await complete(page);
    await page.getByRole("button", { name: button!, exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: message! }),
    ).toBeVisible();
  }
  await enabled(page, "partial");
  await page.goto("/forgot-password");
  await expect(
    page.getByRole("button", { name: "Request reset" }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText(
    "Verification is temporarily unavailable",
  );
  expect((await page.request.get("/api/account/security")).status()).toBe(200);
  await page.goto("/account");
  await expect(
    page.getByRole("button", { name: "Change password", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".turnstile-verification")).toHaveCount(0);
});

test("password TOTP challenge and authenticated enrollment/disable never receive a second widget or CAPTCHA token", async ({
  page,
}) => {
  const email = await user(page);
  await enabled(page);
  const signin = await page.request.post("/api/auth/sign-in/email", {
    headers: {
      "Origin": origin,
      "x-captcha-response": `fixture:links-sign-in:${crypto.randomUUID()}`,
    },
    data: { email, password },
  });
  expect(signin.status()).toBe(200);
  const enrollment = await page.request.post("/api/auth/two-factor/enable", {
    headers: { Origin: origin },
    data: { password, method: "totp" },
  });
  expect(enrollment.status()).toBe(200);
  const uri = z
    .object({ totpURI: z.string() })
    .parse(await enrollment.json()).totpURI;
  expect(
    (
      await page.request.post("/api/auth/two-factor/verify-totp", {
        headers: { Origin: origin },
        data: { code: totp(uri), trustDevice: false },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/account");
  await expect(
    page.getByRole("status", { name: "Authenticator status" }),
  ).toHaveText("On");
  await expect(page.locator(".turnstile-verification")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await complete(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verify code" })).toBeVisible();
  await expect(page.locator(".turnstile-verification")).toHaveCount(0);
  let leakedToken = false;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("/two-factor/"))
      leakedToken ||= Boolean(request.headers()["x-captcha-response"]);
  });
  await page.getByLabel("Authenticator code").fill(totp(uri));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
  expect(leakedToken).toBe(false);
  expect(
    (
      await page.request.post("/api/auth/two-factor/disable", {
        headers: { Origin: origin },
        data: { password },
      })
    ).status(),
  ).toBe(200);
});

test("responsive re-render and bfcache discard verification without automatic submit or token storage", async ({
  page,
}) => {
  await enabled(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/login");
  const primary = page.getByRole("button", { name: "Sign in", exact: true });
  await complete(page);
  await expect(primary).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 812 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(primary).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Complete fixture verification" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  let calls = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.startsWith("/api/auth/")
    )
      calls++;
  });
  await complete(page);
  await expect(primary).toBeEnabled();
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(primary).toBeDisabled();
  // Google capability also re-reads config on restored Back, remounting the
  // verification. Its old callback must not re-enable the replacement flow.
  await expect(
    page.getByRole("button", { name: "Complete fixture verification" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const records = (
      window as Window & {
        fixtureWidgets?: Array<{
          removed: boolean;
          options: { callback: (token: string) => void };
        }>;
      }
    ).fixtureWidgets!;
    records
      .find((record) => record.removed)!
      .options.callback("fixture:links-sign-in:bfcache-late");
  });
  await expect(primary).toBeDisabled();
  expect(calls).toBe(0);
  expect(
    await page.evaluate(() =>
      JSON.stringify([
        localStorage,
        sessionStorage,
        history.state,
        location.href,
      ]).includes("fixture:links-"),
    ),
  ).toBe(false);
});

test("normal public auth trusts its title and controls, with no empty feedback spacer and compact centered Google", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { googleEnabled: true, turnstile: { status: "disabled" } },
    }),
  );
  await page.goto("/login");
  const form = page.getByRole("form", { name: "Sign in", exact: true });
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toHaveCount(1);
  await expect(form.getByRole("heading")).toHaveCount(0);
  await expect(
    page.getByText("Save useful bookmarks in your own private library.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Authenticator codes protect password sign-in only/),
  ).toHaveCount(0);
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expect(form.getByRole("status")).toHaveCount(0);
  const google = form.getByRole("button", { name: "Continue with Google" });
  await expect(google).toBeVisible();
  const geometry = await form.evaluate((element) => {
    const primary = element
      .querySelector('button[type="submit"]')!
      .getBoundingClientRect();
    const divider = element
      .querySelector('[role="separator"]')!
      .getBoundingClientRect();
    const google = element
      .querySelector(".google-button")!
      .getBoundingClientRect();
    const form = element.getBoundingClientRect();
    return {
      beforeDivider: divider.top - primary.bottom,
      beforeGoogle: google.top - divider.bottom,
      centered:
        Math.abs(
          (google.left + google.right) / 2 - (form.left + form.right) / 2,
        ) < 2,
    };
  });
  expect(geometry.beforeDivider).toBeLessThanOrEqual(16);
  expect(geometry.beforeGoogle).toBeLessThanOrEqual(12);
  expect(geometry.centered).toBe(true);
});

test("verification loading fits 320px at 200% text without assuming a token or an off capability", async ({
  page,
}) => {
  await enabled(page);
  await page.setViewportSize({ width: 320, height: 812 });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(sdk, async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto("/login");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(
    page.locator('.turnstile-verification[aria-busy="true"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  release();
  await expect(
    page.getByRole("button", { name: "Complete fixture verification" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
});
