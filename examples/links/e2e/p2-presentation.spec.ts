import { expect, test, type Page } from "@playwright/test";
import { openNavigation } from "./navigation.js";
test.use({ trace: "off", video: "off", screenshot: "off" });

// Only fictitious, non-sensitive display data is captured in this suite.
async function fixture(page: Page) {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "p2-reader",
          name: "Alex Reader",
          email: "alex@example.com",
          emailVerified: true,
          twoFactorEnabled: false,
          createdAt: "2026-10-01T00:00:00Z",
          updatedAt: "2026-10-01T00:00:00Z",
        },
        session: {
          id: "p2-session",
          userId: "p2-reader",
          token: "display-fixture-only",
          expiresAt: "2099-01-01T00:00:00Z",
          createdAt: "2026-10-01T00:00:00Z",
          updatedAt: "2026-10-01T00:00:00Z",
        },
      },
    }),
  );
  await page.route("**/api/account/security", (route) =>
    route.fulfill({ json: { hasPassword: true } }),
  );
  await page.route("**/api/bookmarks?*", (route) =>
    route.fulfill({
      json: {
        hasMore: false,
        items: [
          {
            id: "873e3c4d-51a1-416d-bd86-4b1f2ac2d5ec",
            title: "A quieter place for your references",
            url: "https://example.com/reading/design",
            description:
              "Thoughtful interfaces make room for what matters. A reading collection about everyday tools and clear visual hierarchy.",
            tags: ["design", "reading"],
            createdAt: "2026-10-01T00:00:00Z",
            updatedAt: "2026-10-01T00:00:00Z",
          },
          {
            id: "873e3c4d-51a1-416d-bd86-4b1f2ac2d5ed",
            title: "Foundation documentation",
            url: "https://example.com/docs",
            description: "Patterns for building reliable products.",
            tags: ["work"],
            createdAt: "2026-10-01T00:00:00Z",
            updatedAt: "2026-10-01T00:00:00Z",
          },
        ],
      },
    }),
  );
}

for (const width of [320, 390, 1280]) {
  test(`P2 rendered library, profile and password decision at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    await fixture(page);
    await page.goto("/bookmarks");
    const add = page.getByRole("link", { name: "Add bookmark", exact: true });
    await expect(add).toBeVisible();
    const heading = await page
      .getByRole("heading", { name: "Bookmarks", exact: true })
      .boundingBox();
    const action = await add.boundingBox();
    expect(
      Math.abs(
        heading!.y + heading!.height / 2 - action!.y - action!.height / 2,
      ),
    ).toBeLessThanOrEqual(2);
    expect(action!.height).toBeGreaterThanOrEqual(44);
    expect(action!.width).toBeGreaterThanOrEqual(44);
    await expect(
      page.getByRole("navigation", { name: "Bookmark pages" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath(`library-${width}.png`),
    });
    await openNavigation(page);
    if (width < 640) {
      const menu = page.getByRole("button", { name: "Open navigation menu" });
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await page.getByRole("link", { name: "Account", exact: true }).focus();
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await menu.click();
      await page.screenshot({
        path: test.info().outputPath(`navigation-${width}.png`),
      });
    }
    await page.getByRole("link", { name: "Account", exact: true }).click();
    await expect(page).toHaveTitle("Account · Links");
    const name = page.getByLabel("Name", { exact: true });
    const save = page.getByRole("button", { name: "Save changes" });
    await expect(save).toBeDisabled();
    await name.fill("  Alex Reader  ");
    await expect(save).toBeDisabled();
    await name.fill("Draft Reader");
    await expect(save).toBeEnabled();
    const node = await name.elementHandle();
    await Promise.all([
      page.waitForResponse("**/api/auth/get-session*"),
      page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      ),
    ]);
    await expect(name).toHaveValue("Draft Reader");
    expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`account-${width}.png`),
    });
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Change password" });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText("replacement session");
    await page.setViewportSize({ width, height: 480 });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.height).toBeLessThanOrEqual(480);
    await page.screenshot({
      path: test.info().outputPath(`password-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Change password", exact: true }),
    ).toBeFocused();
  });
}

test("password reveal preserves exact bytes and accessible field associations", async ({
  page,
}) => {
  test.info().annotations.push({
    type: "security",
    description:
      "Ephemeral input only; no screenshots of populated password controls.",
  });
  await page.goto("/login");
  const input = page.getByLabel("Password", { exact: true });
  await input.fill("  password with spaces  ");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(input).toHaveAttribute("type", "text");
  await expect(input).toHaveValue("  password with spaces  ");
  await expect(input).toHaveAttribute("autocomplete", "current-password");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toHaveValue("  password with spaces  ");
  await page.getByRole("link", { name: "Use a magic link" }).click();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toHaveValue("");
});

for (const width of [390, 1280]) {
  test(`P2 public compositions and persistent email result at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.route("**/api/auth/get-session*", (route) =>
      route.fulfill({ json: null }),
    );
    await page.route("**/api/config", (route) =>
      route.fulfill({
        json: { googleEnabled: true, turnstile: { status: "disabled" } },
      }),
    );
    for (const [label, path] of [
      ["home", "/"],
      ["login", "/login"],
      ["signup", "/signup"],
      ["magic", "/magic-link"],
      ["forgot", "/forgot-password"],
      ["reset-invalid", "/reset-password"],
      ["verify-pending", "/verify-email?pending=1"],
      ["challenge-recovery", "/two-factor"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`${label}-${width}.png`),
      });
    }
    let requests = 0;
    await page.route("**/api/auth/request-password-reset", (route) => {
      requests++;
      return route.fulfill({ json: { status: true } });
    });
    await page.goto("/forgot-password?next=%2Fbookmarks%2Fnew");
    await page.getByLabel("Email", { exact: true }).fill("reader@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(
      page.getByRole("heading", { name: "Check your email", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "If an account exists for this email",
    );
    await expect(page.getByRole("form")).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath(`email-result-${width}.png`),
    });
    await page.getByRole("button", { name: "Use another email" }).click();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
    expect(requests).toBe(1);
    await expect(
      page.getByRole("link", { name: "Sign in", exact: true }),
    ).toHaveAttribute("href", "/login?next=%2Fbookmarks%2Fnew");
  });
}

test("optional editor errors reveal their fields and focus the first invalid detail", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/bookmarks/new");
  await page.getByLabel("URL", { exact: true }).fill("https://example.com");
  await page.getByLabel("Title", { exact: true }).fill("Draft reference");
  await page.getByRole("button", { name: "Add details" }).click();
  await page.getByLabel("Description (optional)").fill("d".repeat(2001));
  await page.getByRole("button", { name: "Hide details" }).click();
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(page.getByLabel("Description (optional)")).toBeFocused();
  await expect(page.getByLabel("Description (optional)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Draft reference",
  );
});
