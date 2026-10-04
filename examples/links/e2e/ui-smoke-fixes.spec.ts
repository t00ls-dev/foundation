import { expect, test, type Locator, type Page } from "@playwright/test";
import { z } from "zod";

test.use({ trace: "off", video: "off", screenshot: "off" });
const origin = "http://127.0.0.1:5174";
const password = "correct-horse-battery-staple";

async function account(page: Page) {
  const email = `smoke-ui-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { Origin: origin },
        data: { email, name: "Smoke Reader", password },
      })
    ).ok(),
  ).toBe(true);
  const mail = await page.request.get(
    `/__test/mail?${new URLSearchParams({ email, subject: "Verify your email" })}`,
  );
  const url = z.object({ text: z.string() }).parse(await mail.json()).text;
  expect((await page.request.get(url)).ok()).toBe(true);
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        headers: { Origin: origin },
        data: { email, password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/account");
  await expect(
    page.getByRole("button", { name: "Change password", exact: true }),
  ).toBeVisible();
}

async function primary(button: Locator) {
  await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
  const ratio = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    function luminance(color: string) {
      const channels = color
        .match(/\d+/g)!
        .slice(0, 3)
        .map((channel) => {
          const value = Number(channel) / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
      return (
        channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      );
    }
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (
      (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05)
    );
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

test("filled buttons keep shared high-contrast foreground across Auth, Account and Bookmarks; pending stays distinct", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, name] of [
    ["/login", "Sign in"],
    ["/signup", "Create account"],
    ["/magic-link", "Send link"],
    ["/forgot-password", "Request reset"],
  ]) {
    await page.goto(path!);
    const button = page.getByRole("button", { name: name!, exact: true });
    await primary(button);
    await expect(button).toHaveCSS("opacity", "1");
  }
  await account(page);
  await page.getByRole("button", { name: "Edit name" }).click();
  const save = page.getByRole("button", { name: "Save name" });
  await primary(save);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/update-user", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByLabel("Name", { exact: true }).fill("Updated Smoke Reader");
  await save.click();
  const pending = page.getByRole("button", { name: "Saving name..." });
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveCSS("opacity", "0.65");
  await primary(pending);
  release();
  await expect(page.getByText("Name saved.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await primary(
    page
      .getByRole("form", { name: "Change password" })
      .getByRole("button", { name: "Change password", exact: true }),
  );
  await page.getByRole("button", { name: "Cancel password edit" }).click();
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await primary(page.getByRole("button", { name: "Continue with password" }));
  await page.keyboard.press("Escape");
  await page.goto("/bookmarks/new");
  await primary(
    page.getByRole("button", { name: "Save bookmark", exact: true }),
  );
  await page.goto("/bookmarks");
  await primary(page.getByRole("button", { name: "Search", exact: true }));
});

test("mobile success toast is compact, readable and contains its touch-sized close control", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await account(page);
  await page.getByRole("button", { name: "Edit name" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Toast Reader");
  await page.getByRole("button", { name: "Save name" }).click();
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Name saved." });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-type", "success");
  await expect(toast).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(toast).toHaveCSS("color", "rgb(23, 35, 29)");
  await expect(toast).not.toHaveCSS("box-shadow", "none");
  await expect(toast).toHaveCSS("border-top-width", "1px");
  const close = toast.getByRole("button", { name: "Close toast" });
  await expect(close).toHaveCSS("position", "static");
  await expect(close).toHaveCSS("transform", "none");
  const geometry = await toast.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const control = element
      .querySelector("[data-close-button]")!
      .getBoundingClientRect();
    return {
      height: box.height,
      width: box.width,
      viewport: document.documentElement.clientWidth,
      closeWidth: control.width,
      closeHeight: control.height,
      contained:
        control.left >= box.left &&
        control.right <= box.right &&
        control.top >= box.top &&
        control.bottom <= box.bottom,
    };
  });
  expect(geometry.height).toBeLessThanOrEqual(80);
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport - 32);
  expect(geometry.closeWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.closeHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.contained).toBe(true);
  await close.click();
  await expect(toast).toHaveCount(0);
  await page.getByRole("button", { name: "Edit name" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Transient Reader");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 6500 });
});

test("Password keeps reset contextual and cancellation returns to normal Security without nested cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await account(page);
  await expect(page.getByRole("link", { name: /password reset/i })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Change password" });
  const field = form.getByLabel("Current password", { exact: true });
  await expect(field).toBeFocused();
  await field.fill("discard-on-cancel");
  await expect(
    form.getByRole("link", {
      name: "Forgot your current password? Use password reset",
    }),
  ).toHaveAttribute("href", "/forgot-password");
  await expect(
    page.getByRole("link", { name: "Back to bookmarks" }),
  ).toHaveCount(0);
  expect(
    await form.evaluate(
      (element) =>
        getComputedStyle(element).borderTopWidth === "0px" &&
        getComputedStyle(element.parentElement!).borderTopWidth === "0px",
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Cancel password edit" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("link", { name: /password reset/i })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Change password", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Set up", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(field).toHaveValue("");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
