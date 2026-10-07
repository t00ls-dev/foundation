import { expect, test, type Locator, type Page } from "@playwright/test";
import { openNavigation } from "./navigation.js";

async function noHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}

async function verticalGap(before: Locator, after: Locator) {
  const following = await after.elementHandle();
  return before.evaluate((element, next) => {
    if (!next) throw new Error("Missing following element");
    // Read both rectangles in one frame; session-loading UI can disappear.
    const first = element.getBoundingClientRect();
    const second = next.getBoundingClientRect();
    return second.top - first.bottom;
  }, following);
}

for (const width of [320, 375, 768, 1280]) {
  test(`public auth shares compact density and contextual navigation at ${width}px without changing return destinations`, async ({
    page,
  }) => {
    await page.route("**/api/config", (route) =>
      route.fulfill({
        json: { googleEnabled: false, turnstile: { status: "disabled" } },
      }),
    );
    const next = "/bookmarks/new?source=auth";
    await page.setViewportSize({ width, height: 900 });
    for (const [path, title, links] of [
      ["/login", "Sign in", ["Create account", "Use a magic link"]],
      ["/signup", "Create account", ["Sign in"]],
      ["/magic-link", "Magic link", ["Sign in"]],
      ["/forgot-password", "Forgot password?", ["Sign in"]],
    ] as const) {
      await page.goto(`${path}?${new URLSearchParams({ next })}`);
      const form = page.getByRole("form", { name: title, exact: true });
      await expect(form.locator('button[type="submit"]')).toBeEnabled();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(form.getByRole("heading")).toHaveCount(0);
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("navigation", { name: "Account navigation" }),
      ).toHaveCount(0);
      const alternatives = page
        .getByRole("navigation", { name: "Authentication options" })
        .getByRole("link");
      await expect(alternatives).toHaveText([...links]);
      for (const link of await page.locator(".auth-layout a").all()) {
        const target = new URL((await link.getAttribute("href"))!, page.url());
        expect(target.pathname).not.toBe(path);
        expect(target.searchParams.get("next")).toBe(next);
      }
      await expect(form.locator(".google-sign-in")).toHaveCount(0);
      await expect(form.getByRole("separator")).toHaveCount(0);
      await expect(form.getByLabel("Email", { exact: true })).toHaveAttribute(
        "spellcheck",
        "false",
      );
      const geometry = await form.evaluate((element) => {
        const fields = [...element.querySelectorAll(".cross-page-field")];
        const gaps = fields
          .slice(1)
          .map(
            (field, index) =>
              field.getBoundingClientRect().top -
              fields[index]!.getBoundingClientRect().bottom,
          );
        const last = fields.at(-1)!;
        const following = last.nextElementSibling!;
        return {
          gaps,
          finalGap:
            following.getBoundingClientRect().top -
            last.getBoundingClientRect().bottom,
        };
      });
      for (const gap of geometry.gaps) expect(gap).toBe(20);
      expect(geometry.finalGap).toBe(20);
      await noHorizontalOverflow(page);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await noHorizontalOverflow(page);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
  });
}

for (const width of [320, 375, 640, 768, 1280]) {
  test(`shared layouts reflow on public pages at ${width}px and at 200% scale`, async ({
    page,
  }) => {
    await page.route("**/api/config", (route) =>
      route.fulfill({
        json: { googleEnabled: true, turnstile: { status: "disabled" } },
      }),
    );
    const routes = [
      "/login",
      "/signup",
      "/magic-link",
      "/forgot-password",
      "/reset-password",
      "/verify-email?pending=1",
    ];
    // 640 CSS px also checks the reflow available at 200% browser zoom on 1280px.
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator(".auth-page")).toBeVisible();
      if (route === "/login" || route === "/signup")
        await expect(
          page.getByRole("button", { name: "Continue with Google" }),
        ).toBeVisible();
      await noHorizontalOverflow(page);
      // Exercise enlarged text/controls too, beyond viewport-only reflow.
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      await noHorizontalOverflow(page);
    }
  });
}

for (const width of [320, 390, 1280]) {
  test(`cross-page intros and secondary actions use shared spacing, targets and state variants at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const homeCard = page.locator(".home-intro");
    await expect(
      homeCard.getByRole("link", { name: "Open Links" }),
    ).toBeVisible();
    expect(
      await verticalGap(
        homeCard.locator("p").first(),
        homeCard.locator(".actions"),
      ),
    ).toBe(16);
    await page.goto("/login");
    const intro = page.locator(".cross-page-intro");
    const form = page.locator(".auth-page > form");
    await expect(form.getByLabel("Email", { exact: true })).toBeVisible();
    expect(await verticalGap(intro, form)).toBe(16);
    for (const state of ["pending=1", "error=expired", ""]) {
      await page.goto(`/verify-email${state ? `?${state}` : ""}`);
      const back = page.getByRole("link", {
        name: state.startsWith("error") ? "Back to sign in" : "Sign in",
        exact: true,
      });
      await expect(back).toBeVisible();
      expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await back.focus();
      await expect(back).toHaveCSS("outline-width", "3px");
      const message = page
        .locator(".auth-page")
        .getByRole(state.startsWith("error") ? "alert" : "status");
      await expect(message).toHaveAttribute(
        "role",
        state.startsWith("error") ? "alert" : "status",
      );
      if (!state) {
        await expect(message).toHaveText("Email verified");
        await expect(page.getByRole("heading", { level: 1 })).toHaveCSS(
          "color",
          "rgb(36, 75, 53)",
        );
        await expect(page.locator(".auth-page > p")).toHaveCount(0);
        await expect(back).toHaveCSS("background-color", "rgb(36, 75, 53)");
      }
      await noHorizontalOverflow(page);
    }
    await page.goto("/reset-password?error=INVALID_TOKEN");
    const newLink = page.getByRole("link", {
      name: "Request a new password link",
    });
    await expect(newLink).toBeVisible();
    expect((await newLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await verticalGap(page.getByRole("alert"), newLink),
    ).toBeGreaterThanOrEqual(16);
    await page.route("**/api/auth/reset-password/visual-check?*", (route) =>
      route.fulfill({ status: 503, body: "Unavailable" }),
    );
    await page.goto("/reset-password?token=visual-check");
    const retry = page.getByRole("button", { name: "Retry password link" });
    await expect(retry).toBeVisible();
    expect(await verticalGap(page.getByRole("alert"), retry)).toBe(16);
    await page.unroute("**/api/auth/reset-password/visual-check?*");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await noHorizontalOverflow(page);
  });
}

test("Account title and grouped Name errors stay separate from submit on narrow and wide screens", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "visual-user",
          name: "N".repeat(200),
          email: `${"reader".repeat(20)}@example.com`,
          emailVerified: true,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
        session: {
          id: "visual-session",
          userId: "visual-user",
          token: "fixture-only",
          expiresAt: "2099-01-01T00:00:00.000Z",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      },
    }),
  );
  await page.route("**/api/account/security", (route) =>
    route.fulfill({ json: { hasPassword: true } }),
  );
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/account");
    const form = page.getByRole("form", { name: "Account name" });
    const name = form.getByLabel("Name", { exact: true });
    await expect(name).toHaveValue("N".repeat(200));
    expect(
      await verticalGap(
        page.getByRole("heading", { name: "Account", exact: true }),
        page.getByRole("region", { name: "Profile", exact: true }),
      ),
    ).toBe(24);
    await name.fill(" ");
    const save = form.getByRole("button", { name: "Save changes" });
    await save.click();
    const error = form.getByRole("alert");
    await expect(error).toHaveText("Enter your name");
    await expect(name).toBeFocused();
    expect(await verticalGap(error, save)).toBeGreaterThanOrEqual(16);
    await noHorizontalOverflow(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(await verticalGap(error, save)).toBeGreaterThanOrEqual(32);
    await noHorizontalOverflow(page);
  }
});

for (const width of [320, 375, 640, 1280]) {
  test(`shared layouts keep long private content in bounds at ${width}px and enlarged text`, async ({
    page,
  }) => {
    const userId = "f6b267ef-d429-47d5-8a47-e18b49621881";
    const bookmark = {
      id: "873e3c4d-51a1-416d-bd86-4b1f2ac2d5ec",
      title: "W".repeat(200),
      url: `https://example.com/${"w".repeat(1000)}`,
      description: "W".repeat(2000),
      tags: Array.from(
        { length: 10 },
        (_, index) => `${index}${"w".repeat(39)}`,
      ),
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    await page.route("**/api/auth/get-session*", (route) =>
      route.fulfill({
        json: {
          user: {
            id: userId,
            name: "W".repeat(200),
            email: "reader@example.com",
            emailVerified: true,
            createdAt: bookmark.createdAt,
            updatedAt: bookmark.updatedAt,
          },
          session: {
            id: "visual-session",
            userId,
            token: "visual-fixture",
            expiresAt: "2099-01-01T00:00:00.000Z",
            createdAt: bookmark.createdAt,
            updatedAt: bookmark.updatedAt,
          },
        },
      }),
    );
    await page.route("**/api/bookmarks?*", (route) =>
      route.fulfill({ json: { items: [bookmark], hasMore: true } }),
    );
    await page.route(`**/api/bookmarks/${bookmark.id}`, (route) =>
      route.fulfill({ json: bookmark }),
    );
    await page.route("**/api/account/security", (route) =>
      route.fulfill({ json: { hasPassword: true } }),
    );
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/bookmarks",
      "/bookmarks/new",
      `/bookmarks/${bookmark.id}/edit`,
      "/account",
    ]) {
      await page.goto(path);
      await openNavigation(page);
      await expect(
        page.getByRole("button", { name: "Sign out" }),
      ).toBeVisible();
      if (path === "/bookmarks")
        await expect(page.getByRole("article")).toBeVisible();
      else
        await expect(
          page.getByRole("button", {
            name: path === "/account" ? "Change password" : "Save bookmark",
            exact: true,
          }),
        ).toBeVisible();
      await noHorizontalOverflow(page);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await noHorizontalOverflow(page);
    }
  });
}

test("shared controls provide touch targets, keyboard focus and readable feedback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { googleEnabled: true, turnstile: { status: "disabled" } },
    }),
  );
  await page.route("**/api/auth/request-password-reset", (route) =>
    route.fulfill({ json: { status: true } }),
  );
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  for (const control of await page
    .locator("button, input, nav a, .brand, .auth-recovery-link")
    .all()) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const brand = page.getByRole("link", { name: "Links", exact: true });
  await expect(brand).toBeFocused();
  await expect(brand).toHaveCSS("outline-style", "solid");
  await expect(brand).toHaveCSS("outline-width", "3px");
  const email = page.getByLabel("Email", { exact: true });
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Account navigation" }),
  ).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(email).toBeFocused();
  await expect(email).toHaveCSS("font-size", "16px");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveCSS("border-color", "rgb(161, 43, 34)");
  await expect(email).toBeFocused();
  await noHorizontalOverflow(page);

  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill("reader@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  const success = page
    .getByRole("status")
    .filter({ hasText: "If an account exists" });
  await expect(success).toContainText("If an account exists");
  await expect(success).toHaveAttribute("role", "status");
  await expect(success).toHaveCSS("color", "rgb(23, 35, 29)");
  await noHorizontalOverflow(page);
  await page.emulateMedia({ forcedColors: "active" });
  await page.getByRole("button", { name: "Use another email" }).click();
  await page.getByLabel("Email", { exact: true }).focus();
  await expect(page.getByLabel("Email", { exact: true })).toHaveCSS(
    "outline-style",
    "solid",
  );
});
