import { test, expect, type Page } from "@playwright/test";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { randomUUID } from "node:crypto";
import { readyAccount } from "./helpers.js";
import { localTestDatabaseUrl } from "../test/runtime-acl-fixture.js";
import { AxeBuilder } from "@axe-core/playwright";

async function fixture() {
  const url = process.env.LEVI_DATABASE_URL;
  if (!url || process.env.LEVI_LOCAL_DATABASE !== "1")
    throw new Error("Somente banco sintético.");
  localTestDatabaseUrl(url, "levi_test");
  return createPostgresDatabase(url);
}
async function administrator(page: Page) {
  const email = await readyAccount(page);
  const database = await fixture();
  try {
    const result = await database.client.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email=$1',
      [email],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Conta sintética ausente.");
    await database.client.query(
      'UPDATE "user" SET email=$1 WHERE lower(email)=$2',
      [`${randomUUID()}@example.test`, "admin-configured@example.test"],
    );
    await database.client.query('UPDATE "user" SET email=$2 WHERE id=$1', [
      id,
      "admin-configured@example.test",
    ]);
    return { email, id };
  } finally {
    await database.client.end();
  }
}

test("painel exige guard HTTP real, funciona sem igreja e mantém navegação completa", async ({
  page,
  context,
}) => {
  for (const path of [
    "/admin",
    "/admin/",
    "/admin/extra",
    "/api/admin",
    "/api/admin/session",
    "/%61dmin",
    "/api/%61dmin",
    "/ADMIN",
  ])
    expect((await context.request.get(path)).status(), path).toBe(404);
  await administrator(page);
  await expect(page.getByRole("link", { name: /administr/ })).toHaveCount(0);
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Funcionalidades", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Administradores", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("admin-configured@example.test", { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Funcionalidades", exact: true }),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Voltar ao Levi" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Sua conta está pronta. Você ainda não tem igrejas.",
    }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Funcionalidades", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  expect((await context.request.get("/admin")).status()).toBe(404);
});

test("políticas selected/all/disabled exigem seleção e confirmação e preservam versões", async ({
  page,
}) => {
  const actor = await administrator(page);
  const database = await fixture();
  const orgId = randomUUID();
  const name = `Igreja ${orgId}`;
  try {
    await database.client.query(
      `WITH added AS (INSERT INTO churches(id,name) VALUES($1,$2) RETURNING id) INSERT INTO church_memberships(church_id,user_id,role) SELECT id,'${actor.id}'::uuid,'admin' FROM added`,
      [orgId, name],
    );
    await page.goto("/admin");
    page.on("dialog", (dialog) => dialog.accept());
    await page
      .getByLabel("Política de Membros", { exact: true })
      .selectOption("selected");
    const save = page.getByRole("button", {
      name: "Salvar política de Membros",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await page.getByRole("checkbox", { name: new RegExp(name) }).check();
    await save.click();
    await expect(
      page.getByText("Política de Membros atualizada.", { exact: true }),
    ).toBeVisible();
    await database.client.query(
      "UPDATE feature_flags SET version=version+1 WHERE key='members'",
    );
    await page
      .getByLabel("Política de Membros", { exact: true })
      .selectOption("all");
    await expect(save).toBeDisabled();
    await page
      .getByRole("checkbox", {
        name: "Confirmo habilitar esta funcionalidade para todas as igrejas.",
      })
      .check();
    await save.click();
    await expect(page.getByRole("alert")).toContainText(
      "A funcionalidade foi alterada",
    );
    await page
      .getByLabel("Política de Membros", { exact: true })
      .selectOption("all");
    await page
      .getByRole("checkbox", {
        name: "Confirmo habilitar esta funcionalidade para todas as igrejas.",
      })
      .check();
    await save.click();
    await expect(
      page.getByText("Política de Membros atualizada.", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Política de Membros", { exact: true })
      .selectOption("disabled");
    await save.click();
    await expect(
      page.getByText("Política de Membros atualizada.", { exact: true }),
    ).toBeVisible();
    const policy = await database.client.query<{ policy: string }>(
      "SELECT policy FROM feature_flags WHERE key='members'",
    );
    expect(policy.rows[0]?.policy).toBe("disabled");
  } finally {
    await database.client.end();
  }
});

test("retorno e foco removem dados revogados e respostas antigas não restauram o painel", async ({
  page,
}) => {
  const actor = await administrator(page);
  let release: () => void = () => {};
  let pending: () => void = () => {};
  const received = new Promise<void>((resolve) => {
    pending = resolve;
  });
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/api/admin/features", async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    pending();
    await delayed;
    await route.fulfill({ response }).catch(() => {});
  });
  const database = await fixture();
  try {
    await page.goto("/admin");
    await received;
    await database.client.query(
      'UPDATE "user" SET email_verified=false WHERE id=$1',
      [actor.id],
    );
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByRole("alert")).toHaveText("Recurso não encontrado.");
    release();
    await expect(
      page.getByRole("heading", { name: "Funcionalidades", exact: true }),
    ).toHaveCount(0);
    expect((await page.request.get("/admin")).status()).toBe(404);
    expect((await page.request.get("/api/admin/administrators")).status()).toBe(
      404,
    );
  } finally {
    release();
    await database.client.query(
      'UPDATE "user" SET email_verified=true WHERE id=$1',
      [actor.id],
    );
    await database.client.end();
  }
});
