import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  definePassword,
  emailLink,
  provision,
  readyAccount,
  showOrganizations,
  verifyEmail,
} from "./helpers.js";

const databaseUrl = process.env.LEVI_DATABASE_URL;
if (!databaseUrl || process.env.LEVI_LOCAL_DATABASE !== "1")
  throw new Error("Use a suíte PostgreSQL descartável.");
const observer = await createPostgresDatabase(databaseUrl);
test.afterAll(async () => {
  await observer.client.end();
});

test("429 de navegação mostra espera, evita novas chamadas e permite sair", async ({
  page,
}) => {
  await readyAccount(page);
  await provision(page);
  await showOrganizations(page);
  let blocked = 0;
  await page.route("**/api/organizations", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    blocked++;
    return route.fulfill({
      status: 429,
      headers: { "Retry-After": "60" },
      contentType: "application/json",
      body: JSON.stringify({ erro: "LIMITE_DE_SOLICITACOES" }),
    });
  });
  await page
    .getByRole("button", { name: "Atualizar organizações", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    /Muitas solicitações\. Tente novamente em \d+ segundos\./,
  );
  expect(blocked).toBe(1);
  await page
    .getByRole("button", { name: "Atualizar acesso", exact: true })
    .click();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
  });
  expect(blocked).toBe(1);
  await expect(
    page.getByRole("button", { name: "Sair", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Comece pelo seu e-mail" }),
  ).toBeVisible();
});

test("429 no e-mail não repete envio e não impede login de categoria independente", async ({
  page,
}) => {
  let blocked = 0;
  await page.route("**/api/onboarding/email", (route) => {
    blocked++;
    return route.fulfill({
      status: 429,
      headers: { "X-Retry-After": "60" },
      body: "Too many requests",
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Seu e-mail", { exact: true })
    .fill("synthetic-throttled@example.test");
  await page
    .getByRole("button", { name: "Receber link de acesso", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Muitas solicitações");
  await page
    .getByRole("button", { name: "Receber link de acesso", exact: true })
    .click();
  expect(blocked).toBe(1);
  await page.getByRole("link", { name: "Entrar na minha conta" }).click();
  await expect(
    page.getByRole("heading", { name: "Bem-vindo de volta" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Entrar", exact: true }),
  ).toBeEnabled();
});

test("fluxo real completo, login, seleção e retomada por refresh", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Receber link de acesso", exact: true })
    .click();
  await expect(
    page.getByText("Informe um e-mail válido.", { exact: true }),
  ).toBeVisible();
  const email = await verifyEmail(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "E-mail verificado. Agora, sua senha." }),
  ).toBeVisible();
  await page.getByLabel("Nova senha", { exact: true }).fill("curta");
  await page
    .getByLabel("Confirme a nova senha", { exact: true })
    .fill("diferente");
  await page.getByRole("button", { name: "Salvar minha senha" }).click();
  await expect(
    page.getByText("As senhas precisam ser iguais.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Nova senha", { exact: true })
    .fill("synthetic-browser-password");
  await page
    .getByLabel("Confirme a nova senha", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Salvar minha senha" }).click();
  await expect(
    page.getByRole("heading", { name: "Um lugar para sua comunidade" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Criar organização e primeira igreja" })
    .click();
  await expect(
    page.getByText("Informe um nome para continuar.").first(),
  ).toBeVisible();
  await provision(page);
  await showOrganizations(page);
  await page
    .getByRole("button", {
      name: "Acessar organização Comunidade sintética",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Igrejas da organização" }),
  ).toBeVisible();
  await expect(
    page.getByText("Primeira igreja sintética", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Igrejas da organização" }),
  ).toBeVisible();
  const cookies = await context.cookies();
  expect(
    cookies
      .filter((cookie) => cookie.name.includes("session_token"))
      .every((cookie) => cookie.httpOnly),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.cookie.includes("session_token")),
  ).toBe(false);
  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }));
  expect(storage.local).toEqual([]);
  expect(storage.session).toEqual([]);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Comece pelo seu e-mail" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Entrar na minha conta" }).click();
  await expect(
    page.getByRole("heading", { name: "Bem-vindo de volta" }),
  ).toBeVisible();
  await page.getByLabel("Seu e-mail", { exact: true }).fill(email);
  await page
    .getByLabel("Sua senha", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Suas organizações" }),
  ).toBeVisible();
  await context.clearCookies();
  await page.goto("/igrejas");
  await expect(
    page.getByRole("heading", { name: "Comece pelo seu e-mail" }),
  ).toBeVisible();
  await expect(
    page.getByText("Primeira igreja sintética", { exact: true }),
  ).toHaveCount(0);
});

test("link legado e refresh permitem definir senha sem outra mensagem", async ({
  page,
}) => {
  const email = await verifyEmail(page);
  // Compatibilidade com links de senha já emitidos pelo fluxo anterior.
  expect(
    (
      await page.request.post("/api/onboarding/password-email", {
        data: {},
        headers: { origin: new URL(page.url()).origin },
      })
    ).ok(),
  ).toBe(true);
  const link = await emailLink(email, "Defina sua senha no Levi");
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "Escolha sua senha" }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  const saved = await page.evaluate(() =>
    JSON.stringify([
      Object.entries(localStorage),
      Object.entries(sessionStorage),
      history.state,
    ]),
  );
  expect(saved.includes(new URL(link).pathname.split("/").at(-1)!)).toBe(false);
  await page.reload();
  await expect(page.getByLabel("Nova senha", { exact: true })).toBeVisible();
  await definePassword(page);
});

test("link legado define a senha diretamente pelo formulário", async ({
  page,
}) => {
  const email = await verifyEmail(page);
  expect(
    (
      await page.request.post("/api/onboarding/password-email", {
        data: {},
        headers: { origin: new URL(page.url()).origin },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(await emailLink(email, "Defina sua senha no Levi"));
  await expect(
    page.getByRole("heading", { name: "Escolha sua senha" }),
  ).toBeVisible();
  await definePassword(page);
});

test("link nativo reutilizado retorna erro seguro e URL limpa", async ({
  page,
}) => {
  const email = await verifyEmail(page);
  const used = await emailLink(email, "Verifique seu e-mail no Levi");
  await page.goto(used);
  await expect(page.getByRole("alert")).toContainText("Este link não é válido");
  expect(new URL(page.url()).search).toBe("");
  await expect(
    page.getByRole("heading", { name: "E-mail verificado. Agora, sua senha." }),
  ).toBeVisible();
});

test("falha de rede antes de gravar conserva a chave depois de refresh", async ({
  page,
}) => {
  await readyAccount(page);
  let firstKey = "";
  await page.route("**/api/organizations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    firstKey = route.request().headers()["idempotency-key"] ?? "";
    await route.abort();
  });
  await page
    .getByLabel("Nome da organização", { exact: true })
    .fill("Organização de retomada");
  await page
    .getByLabel("Nome da primeira igreja", { exact: true })
    .fill("Igreja de retomada");
  await page
    .getByRole("button", { name: "Criar organização e primeira igreja" })
    .click();
  await expect(
    page.getByRole("button", { name: "Verificar resultado", exact: true }),
  ).toBeVisible();
  expect(firstKey.length).toBeGreaterThanOrEqual(16);
  await page.unroute("**/api/organizations");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Um lugar para sua comunidade" }),
  ).toBeVisible();
  const posted = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/organizations" &&
      request.method() === "POST",
  );
  await provision(page, "Organização de retomada");
  await showOrganizations(page);
  expect((await posted).headers()["idempotency-key"]).toBe(firstKey);
});

test("resposta perdida após commit recupera o resultado sem outro provisionamento", async ({
  page,
}) => {
  const email = await readyAccount(page);
  let posts = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/organizations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const result = await route.fetch();
    expect(result.status()).toBe(201);
    await gate;
    await route.abort();
  });
  await page
    .getByLabel("Nome da organização", { exact: true })
    .fill("Organização com resposta perdida");
  await page
    .getByLabel("Nome da primeira igreja", { exact: true })
    .fill("Igreja sintética");
  await page
    .getByRole("button", { name: "Criar organização e primeira igreja" })
    .click();
  await expect(
    page.getByRole("button", { name: "Aguarde…", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("form", { name: "Criar organização", exact: true })
    .evaluate((form) => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  release();
  await expect(
    page.getByRole("button", { name: "Verificar resultado", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Verificar resultado", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Visão geral" }),
  ).toBeVisible();
  expect(posts).toBe(1);
  const result = await observer.client.query<{
    provisions: number;
    audit: number;
  }>(
    'SELECT (SELECT count(*)::int FROM onboarding_provisions p WHERE p.user_id=u.id) provisions, (SELECT count(*)::int FROM audit_events a WHERE a.actor=u.id) audit FROM "user" u WHERE email=$1',
    [email],
  );
  expect(result.rows[0]).toEqual({ provisions: 1, audit: 1 });
});

test("troca real entre organizações não conserva igrejas anteriores e revogação remove acesso", async ({
  page,
}) => {
  const email = await readyAccount(page);
  await provision(page, "Organização inicial");
  await showOrganizations(page);
  const user = (
    await observer.client.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email=$1',
      [email],
    )
  ).rows[0]!;
  const second = (
    await observer.client.query<{ id: string }>(
      "INSERT INTO tenants(name) VALUES('Outra organização permitida') RETURNING id",
    )
  ).rows[0]!;
  await observer.client.query(
    "INSERT INTO churches(tenant_id,name) VALUES($1,'Igreja da outra organização')",
    [second.id],
  );
  await observer.client.query(
    "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [second.id, user.id],
  );
  const foreign = (
    await observer.client.query<{ id: string }>(
      "INSERT INTO tenants(name) VALUES('Organização sem vínculo') RETURNING id",
    )
  ).rows[0]!;
  await observer.client.query(
    "INSERT INTO churches(tenant_id,name) VALUES($1,'Igreja sem vínculo')",
    [foreign.id],
  );
  await page
    .getByRole("button", { name: "Atualizar organizações", exact: true })
    .click();
  await expect(
    page.getByText("Organização sem vínculo", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Acessar organização Organização inicial",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Primeira igreja sintética", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Trocar organização", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Acessar organização Outra organização permitida",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Igreja da outra organização", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Primeira igreja sintética", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Igreja sem vínculo", { exact: true }),
  ).toHaveCount(0);
  await observer.client.query(
    "DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
    [second.id, user.id],
  );
  await page
    .getByRole("button", { name: "Atualizar igrejas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Suas organizações" }),
  ).toBeVisible();
  await expect(
    page.getByText("Igreja da outra organização", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Outra organização permitida", { exact: true }),
  ).toHaveCount(0);
});

test("mudança de tenant entre leituras não mistura o nome da organização e suas igrejas", async ({
  page,
}) => {
  const email = await readyAccount(page);
  await provision(page, "Organização escolhida");
  await showOrganizations(page);
  const user = (
    await observer.client.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email=$1',
      [email],
    )
  ).rows[0]!;
  const second = (
    await observer.client.query<{ id: string }>(
      "INSERT INTO tenants(name) VALUES('Outra aba') RETURNING id",
    )
  ).rows[0]!;
  await observer.client.query(
    "INSERT INTO churches(tenant_id,name) VALUES($1,'Igreja da outra aba')",
    [second.id],
  );
  await observer.client.query(
    "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [second.id, user.id],
  );
  await page.route("**/api/context", async (route) => {
    const original = await route.fetch();
    const switched = await page.context().request.post("/api/tenant", {
      headers: { Origin: new URL(page.url()).origin },
      data: { organizationId: second.id },
    });
    expect(switched.status()).toBe(200);
    await route.fulfill({ response: original });
  });
  await page
    .getByRole("button", {
      name: "Acessar organização Organização escolhida",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Suas organizações" }),
  ).toBeVisible();
  await expect(
    page.getByText("Igreja da outra aba", { exact: true }),
  ).toHaveCount(0);
});

test("401 e 403 interceptados removem igrejas exibidas e reconsultam o servidor", async ({
  page,
}) => {
  await readyAccount(page);
  await provision(page);
  await showOrganizations(page);
  await page
    .getByRole("button", {
      name: "Acessar organização Comunidade sintética",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Igrejas da organização" }),
  ).toBeVisible();
  for (const status of [401, 403]) {
    await page.route("**/api/churches", (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          erro: "ACESSO_NEGADO",
          mensagem: "Acesso indisponível.",
        }),
      }),
    );
    await page
      .getByRole("button", { name: "Atualizar igrejas", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Suas organizações" }),
    ).toBeVisible();
    await expect(
      page.getByText("Primeira igreja sintética", { exact: true }),
    ).toHaveCount(0);
    await page.unroute("**/api/churches");
    if (status === 401) {
      await page
        .getByRole("button", {
          name: "Acessar organização Comunidade sintética",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("heading", { name: "Igrejas da organização" }),
      ).toBeVisible();
    }
  }
});

test("409 interceptado não mostra provisionamento fictício e impede nova tentativa", async ({
  page,
}) => {
  await readyAccount(page);
  await page.route("**/api/organizations", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            erro: "ONBOARDING_JA_PROVISIONADO",
            mensagem: "Onboarding já provisionado.",
          }),
        })
      : route.continue(),
  );
  await page
    .getByLabel("Nome da organização", { exact: true })
    .fill("Conflito sintético");
  await page
    .getByLabel("Nome da primeira igreja", { exact: true })
    .fill("Igreja sintética");
  await page
    .getByRole("button", { name: "Criar organização e primeira igreja" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Seu acesso precisa de atenção" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Criar organização e primeira igreja" }),
  ).toHaveCount(0);
});

test("sem API disponível não há navegação protegida; recuperação consulta dados reais", async ({
  page,
}) => {
  await page.route("**/api/onboarding", (route) => route.abort());
  await page.goto("/igrejas");
  await expect(
    page.getByRole("heading", { name: "Vamos tentar novamente" }),
  ).toBeVisible();
  await page.unroute("**/api/onboarding");
  await page
    .getByRole("button", { name: "Atualizar acesso", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Comece pelo seu e-mail" }),
  ).toBeVisible();
});

test("responsividade, teclado e acessibilidade básica da interface real", async ({
  page,
}, info) => {
  await page.goto("/");
  const heading = page.getByRole("heading", {
    name: "Comece pelo seu e-mail",
  });
  await expect(heading).toBeVisible();
  // O efeito da tela posiciona o foco inicial; Tab deve partir desse título.
  await expect(heading).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Seu e-mail", { exact: true })).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const initial = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(initial.violations.map((violation) => violation.id)).toEqual([]);
  await mkdir(join(tmpdir(), "levi-ui-e2e"), { recursive: true });
  await page.screenshot({
    path: join(tmpdir(), `levi-ui-e2e/${info.project.name}.png`),
    fullPage: false,
  });
  await verifyEmail(page);
  await definePassword(page);
  const form = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(form.violations.map((violation) => violation.id)).toEqual([]);
  await provision(page);
  await showOrganizations(page);
  const organization = page.getByRole("button", {
    name: "Acessar organização Comunidade sintética",
    exact: true,
  });
  await expect(organization).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await organization.click();
  await expect(
    page.getByRole("heading", { name: "Igrejas da organização" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const final = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(final.violations.map((violation) => violation.id)).toEqual([]);
});

test("onboarding: contatos opcionais, validação e rascunho preservado ao recuperar foco", async ({
  page,
}, info) => {
  await readyAccount(page);
  const organization = page.getByLabel("Nome da organização", { exact: true });
  const church = page.getByLabel("Nome da primeira igreja", { exact: true });
  await organization.fill("Organização com contatos sintéticos");
  await church.fill("Igreja com contatos sintéticos");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(organization).toHaveValue("Organização com contatos sintéticos");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(tmpdir(), "levi-ui-e2e"), { recursive: true });
  await page.screenshot({
    path: join(tmpdir(), `levi-ui-e2e/${info.project.name}-onboarding.png`),
    fullPage: false,
  });
  await page
    .getByText("Adicionar contatos da igreja (opcional)", { exact: true })
    .click();
  await page
    .getByLabel("Endereço da igreja (opcional)", { exact: true })
    .fill("Endereço sintético da igreja");
  await page
    .getByLabel("Telefone da igreja (opcional)", { exact: true })
    .fill("00 0000-0000");
  const email = page.getByLabel("E-mail da igreja (opcional)", { exact: true });
  await email.fill("inválido");
  await page.locator(".optional-details summary").click();
  await page
    .getByRole("button", {
      name: "Criar organização e primeira igreja",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Informe um e-mail válido.", { exact: true }),
  ).toBeVisible();
  await expect(email).toBeFocused();
  await page.locator(".optional-details summary").click();
  await page
    .getByRole("button", {
      name: "Criar organização e primeira igreja",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  await expect(email).toBeFocused();
  await expect(page.locator(".optional-details")).toHaveAttribute("open", "");
  await email.fill("igreja@example.test");
  await page
    .getByRole("button", {
      name: "Criar organização e primeira igreja",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Igrejas", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Igrejas da organização" }),
  ).toBeVisible();

  await expect(
    page.getByText("Endereço sintético da igreja", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("igreja@example.test", { exact: true }),
  ).toBeVisible();
});

test("e-mail em memória: conferência, reenvio, 429 e alteração explícita", async ({
  page,
}) => {
  const sent: string[] = [];
  await page.route("**/api/onboarding/email", async (route) => {
    const input: unknown = route.request().postDataJSON();
    if (
      !input ||
      typeof input !== "object" ||
      !("email" in input) ||
      typeof input.email !== "string"
    )
      throw new Error("Solicitação sintética sem e-mail válido.");
    sent.push(input.email);
    return route.fulfill(
      sent.length === 2
        ? {
            status: 429,
            headers: { "Retry-After": "90" },
            contentType: "application/json",
            body: JSON.stringify({ erro: "LIMITE_DE_SOLICITACOES" }),
          }
        : {
            contentType: "application/json",
            body: JSON.stringify({ ok: true }),
          },
    );
  });
  await page.goto("/");
  await page.clock.install();
  await page
    .getByLabel("Seu e-mail", { exact: true })
    .fill("conferencia@example.test");
  await page
    .getByRole("button", { name: "Receber link de acesso", exact: true })
    .click();
  await expect(page.locator(".email-confirmation")).toContainText(
    "conferencia@example.test",
  );
  const resend = page.getByRole("button", {
    name: "Reenviar link",
    exact: true,
  });
  await expect(resend).toBeDisabled();
  await page.clock.fastForward(60_000);
  await expect(resend).toBeEnabled();
  await resend.click();
  await expect(page.getByRole("alert")).toContainText("Muitas solicitações");
  await expect(resend).toBeDisabled();
  await page.clock.fastForward(90_000);
  await resend.click();
  expect(sent).toEqual(Array(3).fill("conferencia@example.test"));
  await page
    .getByRole("button", { name: "Alterar e-mail", exact: true })
    .click();
  await expect(page.getByLabel("Seu e-mail", { exact: true })).toHaveValue(
    "conferencia@example.test",
  );
  await page
    .getByRole("button", { name: "Receber link de acesso", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Aguarde");
  expect(sent).toHaveLength(3);
  expect(
    await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
        history.state,
      ]),
    ),
  ).not.toContain("conferencia");
  await page.reload();
  await expect(page.getByLabel("Seu e-mail", { exact: true })).toHaveValue("");
  await page.getByRole("link", { name: "Entrar na minha conta" }).click();
  const viewport = page.viewportSize()!;
  for (const width of [320, 760, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await page.setViewportSize(viewport);
  await expect(page.getByLabel("Etapas para começar")).toHaveCount(0);
  await expect(page).toHaveTitle("Bem-vindo de volta · Levi");
});

test("acesso revogado permanece sem acesso após reload e novo login, sem criar organização", async ({
  page,
}) => {
  const email = await readyAccount(page);
  await provision(page);
  const account = (
    await observer.client.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email=$1',
      [email],
    )
  ).rows[0]!;
  await observer.client.query(
    "DELETE FROM tenant_memberships WHERE user_id=$1",
    [account.id],
  );
  let posts = 0;
  await page.route("**/api/organizations", (route) => {
    if (route.request().method() === "POST") posts++;
    return route.continue();
  });
  for (let check = 0; check < 2; check++) {
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "Seu acesso precisa de atenção",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("form", { name: "Criar organização", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Primeira igreja sintética", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Atualizar acesso", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page
    .getByRole("link", { name: "Entrar na minha conta", exact: true })
    .click();
  await page.getByLabel("Seu e-mail", { exact: true }).fill(email);
  await page
    .getByLabel("Sua senha", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Seu acesso precisa de atenção",
      exact: true,
    }),
  ).toBeVisible();
  expect(posts).toBe(0);
  const count = await observer.client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM onboarding_provisions WHERE user_id=$1",
    [account.id],
  );
  expect(count.rows[0]?.count).toBe(1);
});

test("carregamento conserva só moldura pública e descarta dados quando a sessão termina", async ({
  page,
  context,
}) => {
  await readyAccount(page);
  await provision(page, "Organização privada da sessão anterior");
  await expect(page.locator(".context-label")).toContainText(
    "Organização privada da sessão anterior",
  );
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/churches", async (route) => {
    await waiting;
    await route.continue();
  });
  await page.getByRole("link", { name: "Membros", exact: true }).click();
  await expect(page.locator(".loading-sidebar")).toBeVisible();
  await expect(page.locator(".context-label")).toHaveCount(0);
  await expect(
    page.getByText("Organização privada da sessão anterior", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Navegação da organização" }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".loading")
      .evaluate(
        (element) => getComputedStyle(element, "::before").animationName,
      ),
  ).toBe("none");
  await context.clearCookies();
  release();
  await expect(
    page.getByRole("heading", { name: "Comece pelo seu e-mail", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".loading-sidebar")).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "Filtrar membros", exact: true }),
  ).toHaveCount(0);
});

test("provisionamento confirmado exige contexto autorizado antes de abrir painel", async ({
  page,
}) => {
  await readyAccount(page);
  await page.route("**/api/context", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        organizationId: "11111111-1111-4111-8111-111111111111",
        organizationName: "Organização sintética",
        role: "admin",
        membersEnabled: true,
      }),
    }),
  );
  await page
    .getByLabel("Nome da organização", { exact: true })
    .fill("Organização cuja sessão mudou");
  await page
    .getByLabel("Nome da primeira igreja", { exact: true })
    .fill("Igreja confirmada");
  await page
    .getByRole("button", {
      name: "Criar organização e primeira igreja",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Suas organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "Sua sessão ou seu acesso mudou",
  );
  await expect(
    page.getByRole("form", { name: "Criar organização", exact: true }),
  ).toHaveCount(0);
});

test("resposta de provisionamento da sessão anterior não restaura nomes no novo onboarding", async ({
  page,
  context,
  browser,
}) => {
  await readyAccount(page);
  const otherContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const gate = { release: () => {}, entered: () => {} };
  const waiting = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    gate.entered = resolve;
  });
  try {
    await readyAccount(await otherContext.newPage());
    await page.route("**/api/organizations", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      gate.entered();
      await waiting;
      return route.fulfill({ response });
    });
    await page
      .getByLabel("Nome da organização", { exact: true })
      .fill("Organização privada da primeira sessão");
    await page
      .getByLabel("Nome da primeira igreja", { exact: true })
      .fill("Igreja privada da primeira sessão");
    await page
      .getByRole("button", {
        name: "Criar organização e primeira igreja",
        exact: true,
      })
      .click();
    await entered;
    await context.clearCookies();
    await context.addCookies(await otherContext.cookies());
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByLabel("Nome da organização", { exact: true }),
    ).toHaveValue("");
    gate.release();
    await expect(
      page.getByRole("button", {
        name: "Criar organização e primeira igreja",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      page.getByLabel("Nome da organização", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByLabel("Nome da primeira igreja", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("heading", { name: "Visão geral", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".notice.success")).toHaveCount(0);
  } finally {
    gate.release();
    await otherContext.close();
  }
});
