import { expect, type Page } from "@playwright/test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

export function syntheticEmail() {
  return `${randomUUID()}@example.test`;
}
export async function emailLink(
  email: string,
  subject: string,
): Promise<string> {
  const directory = process.env.LEVI_TEST_MAIL_DIR;
  if (!directory) throw new Error("Caixa sintética não configurada.");
  for (let attempt = 0; attempt < 100; attempt++) {
    const files = await Promise.all(
      (await readdir(directory)).map(async (file) => ({
        file,
        time: (await stat(join(directory, file))).mtimeMs,
      })),
    );
    for (const { file } of files.sort((a, b) => b.time - a.time)) {
      const message = JSON.parse(
        await readFile(join(directory, file), "utf8"),
      ) as { to: string; subject: string; text: string };
      if (message.to === email && message.subject === subject) {
        const url = message.text.match(/https?:\/\/\S+/)?.[0];
        if (url) return url;
      }
    }
    await setTimeout(50);
  }
  throw new Error("Mensagem sintética não recebida.");
}
export async function verifyEmail(page: Page, email = syntheticEmail()) {
  await page.goto("/");
  await page.getByLabel("Seu e-mail", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Receber link de acesso", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Confira sua caixa de entrada" }),
  ).toBeVisible();
  await page.goto(await emailLink(email, "Verifique seu e-mail no Levi"));
  await expect(
    page.getByRole("heading", {
      name: "Sua conta está pronta. Você ainda não tem igrejas.",
    }),
  ).toBeVisible();
  return email;
}
export async function definePassword(page: Page) {
  if (!(await page.getByLabel("Nova senha", { exact: true }).isVisible()))
    await page.goto("/conta/senha");
  await page
    .getByLabel("Nova senha", { exact: true })
    .fill("synthetic-browser-password");
  await page
    .getByLabel("Confirme a nova senha", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Salvar minha senha" }).click();
  await expect(
    page.getByText("Senha definida. Sua conta está pronta para continuar.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/criar-igreja");
  await expect(
    page.getByRole("heading", { name: "Um lugar para sua comunidade" }),
  ).toBeVisible();
}
export async function readyAccount(page: Page) {
  const email = await verifyEmail(page);
  await definePassword(page);
  return email;
}
export async function provision(page: Page, name = "Comunidade sintética") {
  await page.getByLabel("Nome da organização", { exact: true }).fill(name);
  await page
    .getByLabel("Nome da primeira igreja", { exact: true })
    .fill("Primeira igreja sintética");
  await page
    .getByRole("button", { name: "Criar organização e primeira igreja" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Visão geral" }),
  ).toBeVisible();
}

export async function showOrganizations(page: Page) {
  await page.locator(".navigation-more summary").click();
  await page
    .getByRole("link", { name: "Trocar organização", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Suas organizações" }),
  ).toBeVisible();
}
