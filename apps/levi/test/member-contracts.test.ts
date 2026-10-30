import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  readMember,
  readMemberFilters,
  readMemberEdit,
} from "../src/member-contracts.js";
import { isCivilDate, formatCivilDate } from "../src/member-types.js";
import { memberApi, ApiError } from "../web/src/api.js";
const churchId = "11111111-1111-4111-8111-111111111111";
const body = { churchId, name: "Pessoa sintética", status: "Ativo" };
const request = (value: unknown) =>
  new Request("http://localhost/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

await test("membros: contrato mínimo normaliza opcionais ausentes e vazios", async () => {
  const value = await readMember(request(body));
  assert.equal(value.birthDate, null);
  assert.equal(value.address, null);
  assert.equal(value.name, body.name);
  assert.deepEqual(
    await readMember(
      request({ ...body, phone: "  ", email: null, joinedOn: "" }),
    ),
    value,
  );
});
await test("membros: campos pessoais inválidos e extras nunca são ignorados", async () => {
  for (const change of [
    { name: " " },
    { churchId: "x" },
    { status: "Transferido" },
    { status: undefined },
    { organizationId: churchId },
    { id: churchId },
    { birthDate: "2025-02-29" },
    { birthDate: "2024-02-30" },
    { baptismDate: "2020-01-01T00:00:00Z" },
    { joinedOn: "0000-01-01" },
    { email: "invalido" },
    { phone: {} },
    { address: [] },
    { churchRole: false },
    { name: "x".repeat(161) },
    { address: "x".repeat(501) },
    { phone: "a\0b" },
  ]) {
    await assert.rejects(readMember(request({ ...body, ...change })));
  }
});
await test("membros: datas civis gregorianas mantêm dia em fusos diferentes", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of [
      "Pacific/Kiritimati",
      "America/Sao_Paulo",
      "Pacific/Pago_Pago",
      "UTC",
    ]) {
      process.env.TZ = zone;
      assert.equal(isCivilDate("2000-02-29"), true);
      assert.equal(isCivilDate("1900-02-29"), false);
      assert.equal(isCivilDate("2026-13-01"), false);
      assert.equal(formatCivilDate("2000-02-29"), "29/02/2000");
      assert.equal(formatCivilDate(null), "Não informado");
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
await test("membros: paginação limitada, parâmetros desconhecidos e repetidos recusados", () => {
  for (const query of [
    "page=0",
    "page=-1",
    "page=1.5",
    "page=10001",
    "pageSize=101",
    "pageSize=0",
    "page=1&page=2",
    "tenantId=x",
    "status=ativo",
    "churchId=",
    "name=" + "x".repeat(161),
  ])
    assert.throws(() =>
      readMemberFilters(new URL(`http://localhost/api/members?${query}`)),
    );
  assert.deepEqual(readMemberFilters(new URL("http://localhost/api/members")), {
    name: "",
    churchId: null,
    status: null,
    page: 1,
    pageSize: 20,
  });
});
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
await test("membros: cliente não aceita listas ou fichas sem tenant e contrato válido", async () => {
  globalThis.fetch = () =>
    Promise.resolve(
      Response.json({ members: [], page: 1, pageSize: 20, hasNext: false }),
    );
  await assert.rejects(
    memberApi.list(),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
  globalThis.fetch = () =>
    Promise.resolve(
      Response.json({
        churchId: churchId,
        member: {
          ...body,
          id: churchId,
          churchName: "Igreja",
          createdAt: "2026-10-22T00:00:00Z",
          birthDate: "2025-02-29",
        },
      }),
    );
  await assert.rejects(memberApi.find(churchId));
});
await test("membros: criação usa cookies de mesma origem e chave opaca", async () => {
  let headers: Headers | undefined;
  globalThis.fetch = (path, options) => {
    assert.equal(path, "/api/members");
    assert.equal(options?.credentials, "same-origin");
    assert.equal(options?.cache, "no-store");
    headers = new Headers(options?.headers);
    return Promise.resolve(
      Response.json({ churchId: churchId, memberId: churchId }),
    );
  };
  await memberApi.create({ ...body, status: "Ativo" }, "synthetic-request-key");
  assert.equal(headers?.get("Idempotency-Key"), "synthetic-request-key");
});

await test("edição exige versão e rejeita campos de vínculo e metadados", async () => {
  const profile = { name: "Pessoa atualizada", version: 1 };
  const result = await readMemberEdit(request(profile));
  assert.equal(result.version, 1);
  assert.equal(result.phone, null);
  for (const change of [
    { version: 0 },
    { version: 1.5 },
    { version: 2147483647 },
    { version: undefined },
    { tenant_id: churchId },
    { churchId },
    { status: "Ativo" },
    { createdAt: "2026-01-01" },
    { email: "inválido" },
  ])
    await assert.rejects(readMemberEdit(request({ ...profile, ...change })));
});
