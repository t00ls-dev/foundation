import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readyAccount, provision, showOrganizations } from "./helpers.js";
const databaseUrl = process.env.LEVI_DATABASE_URL;
if (
  !databaseUrl ||
  process.env.LEVI_LOCAL_DATABASE !== "1" ||
  new URL(databaseUrl).hostname !== "127.0.0.1" ||
  new URL(databaseUrl).pathname !== "/levi_test"
)
  throw new Error("Use a suíte sintética de navegador.");
const observer = await createPostgresDatabase(databaseUrl);
test.afterAll(async () => {
  await observer.client.end();
});
test.use({ timezoneId: "Pacific/Kiritimati" });
async function openMembers(page: Page) {
  const email = await readyAccount(page);
  await provision(page, "Organização sintética de pessoas");
  await showOrganizations(page);
  await page
    .getByRole("button", {
      name: "Acessar organização Organização sintética de pessoas",
      exact: true,
    })
    .click();
  await page.getByRole("link", { name: "Membros", exact: true }).click();
  await expect(
    page.getByText("Nenhum membro cadastrado.", { exact: true }),
  ).toBeVisible();
  const user = (
    await observer.client.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email=$1',
      [email],
    )
  ).rows[0]!;
  const tenant = (
    await observer.client.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM tenant_memberships WHERE user_id=$1",
      [user.id],
    )
  ).rows[0]!;
  const church = (
    await observer.client.query<{ id: string }>(
      "SELECT id FROM churches WHERE tenant_id=$1",
      [tenant.tenant_id],
    )
  ).rows[0]!;
  return {
    email,
    userId: user.id,
    organizationId: tenant.tenant_id,
    churchId: church.id,
  };
}
async function startCreate(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Cadastrar membro", exact: true })
    .click();
  await expect(
    page.getByLabel("Situação (obrigatória)", { exact: true }),
  ).toHaveValue("Ativo");
  await page.getByLabel("Nome (obrigatório)", { exact: true }).fill(name);
}

test("membros: cadastro completo, ficha com datas civis, filtros e acessibilidade móvel", async ({
  page,
}) => {
  await openMembers(page);
  await startCreate(page, "Pessoa sintética completa");
  await page.getByLabel("Nome (obrigatório)", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("Igreja (obrigatória)", { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Situação (obrigatória)", { exact: true })
    .selectOption("Inativo");
  await page
    .getByLabel("Data de nascimento (opcional)", { exact: true })
    .fill("2000-02-29");
  await page
    .getByLabel("Telefone (opcional)", { exact: true })
    .fill("+55 11 0000-0000");
  await page
    .getByLabel("E-mail de contato (opcional)", { exact: true })
    .fill("contato@example.test");
  await page
    .getByLabel("Data de ingresso conhecida (opcional)", { exact: true })
    .fill("2020-01-01");
  await page
    .getByLabel("Endereço (opcional)", { exact: true })
    .fill("Endereço sintético");
  await page
    .getByLabel("Data de batismo (opcional)", { exact: true })
    .fill("2021-03-01");
  await page
    .getByLabel("Função na igreja (opcional)", { exact: true })
    .fill("Função sintética");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ficha do membro", exact: true }),
  ).toBeVisible();
  for (const value of [
    "Pessoa sintética completa",
    "29/02/2000",
    "01/01/2020",
    "01/03/2021",
    "contato@example.test",
    "Inativo",
  ])
    await expect(page.getByText(value, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(
    page.getByText("Pessoa sintética completa", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Voltar aos membros", exact: true })
    .click();
  await page.getByLabel("Nome", { exact: true }).fill("não existe");
  await page
    .getByRole("button", { name: "Filtrar membros", exact: true })
    .click();
  await expect(
    page.getByText("Nenhum membro neste recorte.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Nome", { exact: true }).fill("sintética");
  if (!(await page.getByLabel("Situação", { exact: true }).isVisible()))
    await page.getByText("Mais filtros", { exact: true }).click();
  await page.getByLabel("Situação", { exact: true }).selectOption("Ativo");
  await page
    .getByRole("button", { name: "Filtrar membros", exact: true })
    .click();
  await expect(
    page.getByText("Nenhum membro neste recorte.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Situação", { exact: true }).selectOption("Inativo");
  await page
    .getByRole("button", { name: "Filtrar membros", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Consultar ficha de Pessoa sintética completa",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: "Consultar ficha de Pessoa sintética completa",
      exact: true,
    })
    .click();
  await page
    .getByRole("link", { name: "Voltar aos membros", exact: true })
    .click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(
    "sintética",
  );
  await expect(page.getByLabel("Situação", { exact: true })).toHaveValue(
    "Inativo",
  );
  expect(page.url()).not.toContain("sint");
});

test("membros: cadastro mínimo, paginação e nenhuma persistência pessoal no navegador", async ({
  page,
}) => {
  const who = await openMembers(page);
  await startCreate(page, "Pessoa mínima sintética");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa mínima sintética", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Não informado", { exact: true })).toHaveCount(7);
  for (let index = 0; index < 20; index++) {
    const response = await page.request.post("/api/members", {
      headers: {
        Origin: new URL(page.url()).origin,
        "Idempotency-Key": randomUUID(),
      },
      data: {
        name: `Pessoa sintética ${String(index).padStart(2, "0")}`,
        churchId: who.churchId,
        status: "Ativo",
      },
    });
    expect(response.status()).toBe(201);
  }
  await page
    .getByRole("link", { name: "Voltar aos membros", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: /^Consultar ficha de Pessoa/ }),
  ).toHaveCount(20);
  await page
    .getByRole("button", { name: "Próxima página", exact: true })
    .click();
  await expect(page.getByText("Página 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Consultar ficha de Pessoa/ }),
  ).toHaveCount(1);
  await page.getByRole("link", { name: /^Consultar ficha de Pessoa/ }).click();
  await expect(
    page.getByRole("heading", { name: "Ficha do membro", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Página 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Consultar ficha de Pessoa/ }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Página anterior", exact: true })
    .click();
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify([
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ]),
  );
  expect(storage).not.toContain("Pessoa");
  expect(storage).not.toContain("example.test");
});

test("membros: resposta perdida após commit é recuperada no refresh sem duplicação", async ({
  page,
}) => {
  const who = await openMembers(page);
  await startCreate(page, "Pessoa com resposta perdida");
  let key: string | undefined;
  await page.route("**/api/members", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    key = route.request().headers()["idempotency-key"];
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Consultar resultado", exact: true }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.stringify(Object.entries(sessionStorage)),
  );
  expect(stored).toContain(key!);
  expect(stored).not.toContain("Pessoa");
  await page.unroute("**/api/members");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ficha do membro", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa com resposta perdida", { exact: true }),
  ).toBeVisible();
  const count = (
    await observer.client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM members WHERE tenant_id=$1",
      [who.organizationId],
    )
  ).rows[0]!.count;
  expect(count).toBe(1);
});

test("membros: troca organizacional e revogação removem ficha e listagem anteriores", async ({
  page,
}) => {
  const who = await openMembers(page);
  await startCreate(page, "Pessoa da primeira organização");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa da primeira organização", { exact: true }),
  ).toBeVisible();
  const tenant = (
    await observer.client.query<{ id: string }>(
      "INSERT INTO tenants(name) VALUES('Outra organização de pessoas') RETURNING id",
    )
  ).rows[0]!;
  await observer.client.query(
    "INSERT INTO churches(tenant_id,name) VALUES($1,'Outra igreja de pessoas')",
    [tenant.id],
  );
  await observer.client.query(
    "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [tenant.id, who.userId],
  );
  await page.locator(".navigation-more summary").click();
  await page
    .getByRole("link", { name: "Trocar organização", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa da primeira organização", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Acessar organização Outra organização de pessoas",
      exact: true,
    })
    .click();
  await page.getByRole("link", { name: "Membros", exact: true }).click();
  await expect(
    page.getByText("Nenhum membro cadastrado.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa da primeira organização", { exact: true }),
  ).toHaveCount(0);
  await startCreate(page, "Pessoa da segunda organização");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa da segunda organização", { exact: true }),
  ).toBeVisible();
  await observer.client.query(
    "DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
    [tenant.id, who.userId],
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Suas organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa da segunda organização", { exact: true }),
  ).toHaveCount(0);
});

test("membros: resposta de tenant divergente e perda de sessão não mantêm dados protegidos", async ({
  page,
}) => {
  await openMembers(page);
  await startCreate(page, "Pessoa protegida sintética");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa protegida sintética", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/members?*", async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: { ...data, organizationId: randomUUID() },
    });
  });
  await page
    .getByRole("link", { name: "Voltar aos membros", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Suas organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa protegida sintética", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/members?*");
  await page
    .getByRole("button", {
      name: "Acessar organização Organização sintética de pessoas",
      exact: true,
    })
    .click();
  await page.getByRole("link", { name: "Membros", exact: true }).click();
  await expect(
    page.getByText("Pessoa protegida sintética", { exact: true }),
  ).toBeVisible();
  await page.context().clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Comece pelo seu e-mail", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa protegida sintética", { exact: true }),
  ).toHaveCount(0);
});

test("membros: capacidade desabilitada remove dados e navegação e impede abertura direta", async ({
  page,
}) => {
  await openMembers(page);
  await startCreate(page, "Pessoa sintética com acesso removido");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Pessoa sintética com acesso removido", { exact: true }),
  ).toBeVisible();
  // Teste do contrato visual: a política real por organização é exercitada em workerd.
  await page.route("**/api/context", async (route) => {
    const response = await route.fetch();
    const context = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: { ...context, membersEnabled: false },
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Suas organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa sintética com acesso removido", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Acessar organização Organização sintética de pessoas",
      exact: true,
    })
    .click();
  await page.locator(".navigation-more summary").click();
  await expect(
    page.getByRole("link", { name: "Trocar organização", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Membros", exact: true }),
  ).toHaveCount(0);
  await page.goto("/membros");
  await expect(
    page.getByRole("heading", { name: "Suas organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa sintética com acesso removido", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cadastrar membro", exact: true }),
  ).toHaveCount(0);
});

test("membros: Enter não grava, confirmação explícita, erros locais e edição acessível", async ({
  page,
}, info) => {
  const who = await openMembers(page);
  await startCreate(page, "Pessoa para revisão");
  const name = page.getByLabel("Nome (obrigatório)", { exact: true });
  let writes = 0;
  page.on("request", (request) => {
    if (
      ["POST", "PATCH"].includes(request.method()) &&
      /\/api\/members(?:\/[^/]+)?$/.test(new URL(request.url()).pathname)
    )
      writes++;
  });
  await name.press("Enter");
  await page
    .getByLabel("Telefone (opcional)", { exact: true })
    .fill("Contato sintético");
  await page.getByLabel("Telefone (opcional)", { exact: true }).press("Enter");
  await page
    .getByRole("form", { name: "Cadastrar membro", exact: true })
    .evaluate((form) => (form as HTMLFormElement).requestSubmit());
  expect(writes).toBe(0);
  expect(
    (
      await observer.client.query<{ n: number }>(
        "SELECT count(*)::int n FROM members WHERE tenant_id=$1",
        [who.organizationId],
      )
    ).rows[0]!.n,
  ).toBe(0);
  // Voltar de outro app mantém o rascunho, mas o envio revalida autoridade no servidor.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(name).toHaveValue("Pessoa para revisão");
  await name.fill(" ");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Informe o nome do membro.", { exact: true }),
  ).toBeVisible();
  await expect(name).toBeFocused();
  expect(writes).toBe(0);
  await name.fill("Pessoa para revisão");
  await page
    .getByLabel("E-mail de contato (opcional)", { exact: true })
    .fill("inválido");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByText("Informe um e-mail válido.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("E-mail de contato (opcional)", { exact: true })
    .fill("sintetico@example.test");
  const save = page.getByRole("button", { name: "Salvar membro", exact: true });
  await save.focus();
  await save.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Ficha do membro", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Membro cadastrado com sucesso. Confira os dados na ficha abaixo.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(writes).toBe(1);
  await page
    .getByRole("button", { name: "Editar membro", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Editar membro", exact: true }),
  ).toBeVisible();
  await expect(name).toHaveValue("Pessoa para revisão");
  await expect(
    page.getByLabel("Igreja (obrigatória)", { exact: true }),
  ).toHaveCount(0);
  await name.fill("Pessoa com cadastro atualizado");
  await name.press("Enter");
  expect(writes).toBe(1);
  await page.getByLabel("Telefone (opcional)", { exact: true }).fill("");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await expect(
    page.getByText("Dados do membro atualizados com sucesso.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Pessoa com cadastro atualizado",
      exact: true,
    }),
  ).toBeVisible();
  const saved = (
    await observer.client.query<{
      version: number;
      phone: string | null;
      church_id: string;
    }>("SELECT * FROM members WHERE tenant_id=$1", [who.organizationId])
  ).rows;
  expect(saved).toHaveLength(1);
  expect(saved[0]!.version).toBe(2);
  expect(saved[0]!.phone).toBeNull();
  expect(saved[0]!.church_id).toBe(who.churchId);
  await page
    .getByRole("button", { name: "Editar membro", exact: true })
    .click();
  await expect(name).toHaveValue("Pessoa com cadastro atualizado");
  await name.fill("Rascunho em conflito");
  await observer.client.query(
    "UPDATE members SET version=version+1 WHERE tenant_id=$1",
    [who.organizationId],
  );
  await page
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await expect(
    page.getByText(/Este cadastro foi atualizado em outra sessão/),
  ).toBeVisible();
  await expect(name).toHaveValue("Rascunho em conflito");
  expect(
    (
      await observer.client.query<{ name: string }>(
        "SELECT name FROM members WHERE tenant_id=$1",
        [who.organizationId],
      )
    ).rows[0]!.name,
  ).toBe("Pessoa com cadastro atualizado");
  // Somente fixtures sintéticas, sem tokens ou credenciais nas evidências.
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(tmpdir(), "levi-ui-e2e"), { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(tmpdir(), `levi-ui-e2e/${info.project.name}-edicao.png`),
    fullPage: false,
  });
});

test("membros: cliques repetidos produzem uma única gravação e uma única ficha", async ({
  page,
}) => {
  const who = await openMembers(page);
  await startCreate(page, "Pessoa com confirmação única");
  let posts = 0;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/members", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    posts++;
    await wait;
    await route.continue();
  });
  const save = page.getByRole("button", { name: "Salvar membro", exact: true });
  await save.click();
  await expect(
    page.getByRole("button", { name: "Salvando…", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("form", { name: "Cadastrar membro", exact: true })
    .evaluate((form) => {
      const button = form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      form.dispatchEvent(
        new SubmitEvent("submit", {
          bubbles: true,
          cancelable: true,
          submitter: button,
        }),
      );
    });
  release();
  await expect(
    page.getByRole("heading", { name: "Ficha do membro", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  expect(
    (
      await observer.client.query<{ n: number }>(
        "SELECT count(*)::int n FROM members WHERE tenant_id=$1",
        [who.organizationId],
      )
    ).rows[0]!.n,
  ).toBe(1);
});

test("interface: navegação, listas e formulários em largura estreita e texto ampliado", async ({
  page,
}, info) => {
  const viewport = page.viewportSize()!;
  await openMembers(page);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(tmpdir(), "levi-ui-e2e"), { recursive: true });
  await page.screenshot({
    path: join(tmpdir(), `levi-ui-e2e/${info.project.name}-membros-vazio.png`),
    fullPage: false,
  });
  await page.getByRole("link", { name: "Início", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: join(tmpdir(), `levi-ui-e2e/${info.project.name}-painel.png`),
    fullPage: false,
  });
  await page.getByRole("link", { name: "Igrejas", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Igrejas da organização", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(tmpdir(), `levi-ui-e2e/${info.project.name}-igrejas.png`),
    fullPage: false,
  });
  await page.getByRole("link", { name: "Membros", exact: true }).click();
  await startCreate(page, "Pessoa sintética em tela estreita");
  await page.screenshot({
    path: join(tmpdir(), `levi-ui-e2e/${info.project.name}-cadastro.png`),
    fullPage: false,
  });
  for (const width of [320, 375, 760, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 667 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
      document.body.style.fontFamily = "Arial, sans-serif";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByLabel("Função na igreja (opcional)", { exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByLabel("Função na igreja (opcional)", { exact: true }),
    ).toBeVisible();
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
    document.body.style.fontFamily = "";
  });
  // Altura reduzida aproxima a área útil com teclado aberto, sem simular um teclado iOS real.
  await page.setViewportSize({ width: 375, height: 360 });
  const baptism = page.getByLabel("Data de batismo (opcional)", {
    exact: true,
  });
  await baptism.focus();
  await expect(baptism).toBeFocused();
  const save = page.getByRole("button", { name: "Salvar membro", exact: true });
  // WebKit permite Tab entre os segmentos nativos de uma data.
  for (
    let step = 0;
    step < 8 &&
    !(await save.evaluate((button) => button === document.activeElement));
    step++
  )
    await page.keyboard.press("Tab");
  await expect(save).toBeFocused();
  const windowHeight = page.viewportSize()!.height;
  await expect
    .poll(async () => {
      const buttonBounds = await save.boundingBox();
      return (
        buttonBounds!.y >= 0 &&
        buttonBounds!.y + buttonBounds!.height <= windowHeight
      );
    })
    .toBe(true);
  await page.setViewportSize(viewport);
  await save.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(
      tmpdir(),
      `levi-ui-e2e/${info.project.name}-cadastro-confirmacao.png`,
    ),
    fullPage: false,
  });
  await save.click();
  await expect(
    page.getByRole("heading", { name: "Ficha do membro", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(tmpdir(), `levi-ui-e2e/${info.project.name}-ficha.png`),
    fullPage: false,
  });
  await page
    .getByRole("link", { name: "Voltar aos membros", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Consultar ficha de Pessoa sintética em tela estreita",
      exact: true,
    }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(tmpdir(), `levi-ui-e2e/${info.project.name}-lista.png`),
    fullPage: false,
  });
});

test("membros: edição com vínculo revogado é negada e remove o rascunho protegido", async ({
  page,
}) => {
  const who = await openMembers(page);
  await startCreate(page, "Pessoa preservada após revogação");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ficha do membro", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Editar membro", exact: true })
    .click();
  await page
    .getByLabel("Nome (obrigatório)", { exact: true })
    .fill("Alteração sem autorização");
  await observer.client.query(
    "DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
    [who.organizationId, who.userId],
  );
  await page
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Sua conta está pronta. Você ainda não tem igrejas.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Editar membro", exact: true }),
  ).toHaveCount(0);
  const stored = (
    await observer.client.query<{ name: string; version: number }>(
      "SELECT name,version FROM members WHERE tenant_id=$1",
      [who.organizationId],
    )
  ).rows[0]!;
  expect(stored.name).toBe("Pessoa preservada após revogação");
  expect(stored.version).toBe(1);
});

test("interface: contraste da ficha, nomes longos, tablets e texto a 200%", async ({
  page,
}) => {
  const account = await openMembers(page);
  await observer.client.query("UPDATE tenants SET name=$1 WHERE id=$2", [
    "Organização de comunidades com um nome institucional muito longo para navegação em tablets",
    account.organizationId,
  ]);
  await startCreate(
    page,
    "Pessoa sintética com nome muito longo para consulta em telas pequenas",
  );
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Voltar aos membros", exact: true })
    .click();
  const ficha = page.getByRole("link", {
    name: /^Consultar ficha de Pessoa sintética com nome/,
  });
  await expect(ficha).toBeVisible();
  for (const state of ["normal", "hover", "focus"]) {
    if (state === "hover") await ficha.hover();
    if (state === "focus") await ficha.focus();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  for (const fontFamily of ["", "Arial, sans-serif"]) {
    await page.evaluate((family) => {
      document.body.style.fontFamily = family;
    }, fontFamily);
    for (const width of [320, 375, 760, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const fontSize of ["100%", "200%"]) {
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, fontSize);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          `${width}px / ${fontSize}`,
        ).toBe(true);
        const bounds = await page.locator(".admin-nav").boundingBox();
        const main = await page.locator("main").boundingBox();
        expect(
          bounds!.x + bounds!.width <= main!.x ||
            bounds!.y + bounds!.height <= main!.y ||
            ((await page
              .locator(".sidebar")
              .evaluate(
                (element) => getComputedStyle(element).position === "fixed",
              )) &&
              bounds!.y >= 0 &&
              bounds!.y + bounds!.height <= 900),
          `navegação sem sobreposição: ${width}px / ${fontSize}`,
        ).toBe(true);
        for (const button of await page.locator(".admin-nav a:visible").all()) {
          expect(
            await button.evaluate(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
            `link ${await button.textContent()} / ${width} / ${fontSize}`,
          ).toBe(true);
        }
      }
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
    document.body.style.fontFamily = "";
  });
});

test("igreja: atalho filtra membros, reload mantém ID e vazio permite limpar recorte", async ({
  page,
  context,
}) => {
  const who = await openMembers(page);
  const other = (
    await observer.client.query<{ id: string }>(
      "INSERT INTO churches(tenant_id,name) VALUES($1,'Outra igreja sintética') RETURNING id",
      [who.organizationId],
    )
  ).rows[0]!;
  const created = await page.request.post("/api/members", {
    headers: {
      Origin: new URL(page.url()).origin,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      name: "Pessoa da outra igreja",
      churchId: other.id,
      status: "Ativo",
    },
  });
  expect(created.status()).toBe(201);
  await page.getByRole("link", { name: "Igrejas", exact: true }).click();
  const shortcut = page.getByRole("link", {
    name: "Consultar membros de Primeira igreja sintética",
    exact: true,
  });
  await expect(shortcut).toHaveAttribute(
    "href",
    `/membros?igreja=${who.churchId}`,
  );
  const newTabPromise = context.waitForEvent("page");
  await shortcut.click({ modifiers: ["ControlOrMeta"] });
  const newTab = await newTabPromise;
  await expect(
    newTab.getByRole("heading", { name: "Membros", exact: true }),
  ).toBeVisible();
  await expect(
    newTab.getByRole("heading", {
      name: "Nenhum membro neste recorte.",
      exact: true,
    }),
  ).toBeVisible();
  await newTab.close();
  await shortcut.click();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`igreja=${who.churchId}$`));
  await expect(
    page.getByRole("heading", {
      name: "Nenhum membro neste recorte.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Pessoa da outra igreja", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await expect(page).toHaveURL(/\/membros$/);
  await expect(
    page.getByRole("link", {
      name: "Consultar ficha de Pessoa da outra igreja",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Nome", { exact: true })
    .fill("Busca pessoal inexistente");
  await page
    .getByRole("button", { name: "Filtrar membros", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Nenhum membro neste recorte.",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("");
  expect(
    await page.evaluate(() =>
      JSON.stringify([
        location.href,
        history.state,
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    ),
  ).not.toContain("Busca pessoal");
});

test("sessão: duas contas no mesmo tenant descartam rascunho e filtro da conta anterior", async ({
  page,
  context,
  browser,
}) => {
  const who = await openMembers(page);
  await page
    .getByLabel("Nome", { exact: true })
    .fill("Filtro privado da primeira conta");
  await page
    .getByRole("button", { name: "Filtrar membros", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Nenhum membro neste recorte.",
      exact: true,
    }),
  ).toBeVisible();
  await startCreate(page, "Rascunho privado da primeira conta");
  const otherContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const otherPage = await otherContext.newPage();
  try {
    const email = await readyAccount(otherPage);
    const user = (
      await observer.client.query<{ id: string }>(
        'SELECT id FROM "user" WHERE email=$1',
        [email],
      )
    ).rows[0];
    if (!user) throw new Error("Conta sintética ausente.");
    await observer.client.query(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [who.organizationId, user.id],
    );
    const cookies = await otherContext.cookies();
    await context.clearCookies();
    await context.addCookies(cookies);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("heading", { name: "Suas organizações", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("form", { name: "Cadastrar membro", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Rascunho privado da primeira conta", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Acessar organização Organização sintética de pessoas",
        exact: true,
      })
      .click();
    await page.getByRole("link", { name: "Membros", exact: true }).click();
    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("");
    await expect(
      page.getByText("Nenhum membro cadastrado.", { exact: true }),
    ).toBeVisible();
    const saved = await page.evaluate(() =>
      JSON.stringify([
        location.href,
        history.state,
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    );
    expect(saved).not.toContain("privado");
  } finally {
    await otherContext.close();
  }
});

test("sessão: resposta atrasada da mesma conta em sessão anterior não restaura membros nem filtros", async ({
  page,
}) => {
  const who = await openMembers(page);
  await startCreate(page, "Pessoa de resposta da sessão anterior");
  await page
    .getByRole("button", { name: "Salvar membro", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Voltar aos membros", exact: true })
    .click();
  const gate = { release: () => {}, entered: () => {} };
  const waiting = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    gate.entered = resolve;
  });
  await page.route("**/api/members?*", async (route) => {
    const response = await route.fetch();
    gate.entered();
    await waiting;
    await route.fulfill({ response });
  });
  await page.getByLabel("Nome", { exact: true }).fill("Pessoa de resposta");
  await page
    .getByRole("button", { name: "Filtrar membros", exact: true })
    .click();
  await entered;
  const login = await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: new URL(page.url()).origin },
    data: { email: who.email, password: "synthetic-browser-password" },
  });
  expect(login.status()).toBe(200);
  gate.release();
  await expect(
    page.getByRole("heading", { name: "Suas organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Consultar ficha de Pessoa de resposta da sessão anterior",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.unroute("**/api/members?*");
  await page
    .getByRole("button", {
      name: "Acessar organização Organização sintética de pessoas",
      exact: true,
    })
    .click();
  await page.getByRole("link", { name: "Membros", exact: true }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("");
});
