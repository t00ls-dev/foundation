import assert from "node:assert/strict";
import { types } from "node:util";

// Adaptado do Foundation PR #144 (22a4aa0): inspeção defensiva, contexto HTTP
// e diagnóstico em melhor esforço. Catálogos e políticas permanecem do Levi.

const phases = {
  configuration: "configuração",
  ci: "CI aprovada do SHA atual",
  protections: "proteções remotas",
  bundle: "preparação do bundle",
  publish: "publicação Wrangler",
  published: "verificação após publicação",
  cleanup: "limpeza privada",
} as const;

const checks = {
  configuration: "contexto e configuração DEV",
  "main-read": "consulta da master remota",
  "main-sha": "SHA da master remota",
  "local-head": "SHA do checkout local",
  "local-clean": "checkout sem alterações",
  "ci-context": "contexto da execução CI",
  "ci-workflow-read": "consulta do workflow CI",
  "ci-workflow": "identidade do workflow CI",
  "ci-event": "evento e tentativa da CI acionadora",
  "ci-runs-read": "consulta das execuções CI do SHA",
  "ci-runs": "execução CI disponível para o SHA",
  "ci-run-id": "identificador da execução CI",
  "ci-run-read": "consulta da execução CI",
  "ci-run": "identidade e aprovação da execução CI",
  "ci-attempt": "tentativa atual da CI",
  "ci-jobs-read": "consulta dos jobs da CI",
  "ci-jobs-shape": "estrutura da lista de jobs CI",
  "ci-job": "job checks aprovado no SHA",
  "ci-unchanged": "evidência CI inalterada antes do upload",
  "hyperdrive-read": "consulta do Hyperdrive",
  hyperdrive: "origem e cache do Hyperdrive",
  "subdomain-read": "consulta de workers.dev e previews",
  subdomain: "workers.dev e previews desabilitados",
  "domains-read": "consulta dos custom domains",
  "domains-shape": "estrutura da lista de custom domains",
  domains: "custom domains exclusivos do Levi",
  "zone-id": "formato do identificador da zona",
  "zone-read": "consulta da zona Cloudflare",
  zone: "identidade da zona e conta",
  "routes-read": "consulta das rotas da zona",
  "routes-shape": "estrutura da lista de rotas",
  routes: "ausência de rotas alternativas do Levi",
  "pagination-limit": "limite de paginação das listas Cloudflare",
  "bundle-read": "leitura da configuração Wrangler",
  "bundle-parse": "formato da configuração Wrangler",
  "bundle-config": "proteções da configuração de publicação",
  "secrets-memory": "armazenamento de secrets em memória volátil",
  "secrets-file": "preparação privada dos secrets de execução",
  "bundle-directory": "preparação do diretório privado",
  "bundle-files": "gravação dos arquivos privados de publicação",
  wrangler: "publicação pelo Wrangler",
  "deployments-read": "consulta dos deployments do Worker",
  "deployment-shape": "estrutura das versões do deployment",
  "deployment-traffic": "versão única com 100% do tráfego",
  "version-read": "consulta da versão ativa",
  "versions-read": "consulta das versões enviadas",
  "version-latest": "versão ativa presente na lista de versões enviadas",
  "version-inheritance": "versão de origem dos secrets igual à ativa",
  "version-convergence": "convergência da versão ativa entre consultas",
  "version-tag": "tag da versão ativa igual ao SHA",
  "version-binding": "bindings, remetente e recorte da versão ativa",
  "version-unchanged": "versão ativa inalterada antes do upload",
  "admin-read": "requisição anônima do painel administrativo",
  "admin-response": "404 administrativo e ausência de cache",
  "admin-api-read": "requisição anônima da API administrativa",
  "admin-api-response": "404 da API administrativa e ausência de cache",
  "home-read": "requisição da página inicial",
  "home-response": "status e cabeçalhos da página inicial",
  "onboarding-read": "requisição do onboarding anônimo",
  "onboarding-response": "status e cabeçalhos do onboarding anônimo",
  "onboarding-body": "estado anônimo do onboarding",
  "churches-read": "requisição anônima de igrejas",
  "churches-response": "bloqueio anônimo e cabeçalhos de igrejas",
  "members-read": "requisição anônima de membros",
  "members-response": "recorte de membros e cabeçalhos",
  cleanup: "remoção dos arquivos privados temporários",
} as const;

export type DeployCheck = keyof typeof checks;
const categories = new Set([
  "divergência de configuração",
  "resposta inesperada",
  "falha HTTP",
  "erro de rede",
  "falha de operação local",
] as const);
type Category =
  | "divergência de configuração"
  | "resposta inesperada"
  | "falha HTTP"
  | "erro de rede"
  | "falha de operação local";

// Só códigos técnicos conhecidos podem sair do processo. Nunca serializar o erro.
const safeCauses = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "EACCES",
  "EPERM",
  "ENOENT",
  "ENOSPC",
]);

// Inspeciona somente descritores próprios de dados; não invoca accessors,
// coerção, métodos ou traps de proxies. Causas têm profundidade limitada.
export function classifyDeployError(error: unknown): string {
  try {
    const seen = new Set<object>();
    for (let depth = 0; depth < 8; depth++) {
      if (
        !error ||
        typeof error !== "object" ||
        types.isProxy(error) ||
        seen.has(error)
      )
        break;
      seen.add(error);
      const current = error;
      const own = (key: string): unknown =>
        Object.getOwnPropertyDescriptor(current, key)?.value;
      const code = own("code");
      if (typeof code === "string" && safeCauses.has(code)) return code;
      if (own("name") === "TimeoutError") return "TIMEOUT";
      error = own("cause");
    }
  } catch {
    // A inspeção não pode alterar a operação nem emitir a exceção recebida.
  }
  return "UNKNOWN";
}

function catalogKey<T extends object>(
  catalog: T,
  value: unknown,
): value is Extract<keyof T, string> {
  return typeof value === "string" && Object.hasOwn(catalog, value);
}

function httpStatus(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

export class DeployDiagnostics {
  private currentPhase: keyof typeof phases = "configuration";
  private readonly reported = new WeakSet<object>();

  get phase(): keyof typeof phases {
    return this.currentPhase;
  }
  set phase(value: keyof typeof phases) {
    this.currentPhase = catalogKey(phases, value) ? value : "configuration";
  }
  private check: DeployCheck = "configuration";
  private category: Category = "divergência de configuração";
  private status: number | undefined;

  constructor(
    private readonly progress: (message: string) => void = () => {},
  ) {}

  start(
    check: DeployCheck,
    category: Category = "divergência de configuração",
    status?: number,
  ) {
    this.check = catalogKey(checks, check) ? check : "configuration";
    this.category = categories.has(category)
      ? category
      : "divergência de configuração";
    this.status = httpStatus(status);
    try {
      this.progress(
        `Deploy DEV: etapa: ${phases[this.phase]}; verificação: ${checks[this.check]}.`,
      );
    } catch {
      // Falha de apresentação não substitui sucesso ou erro operacional.
    }
  }

  verify<T>(check: DeployCheck, operation: () => T): T {
    this.inspect(check);
    return operation();
  }

  // Valida os dados da resposta atual, mantendo seu status para o diagnóstico.
  // Operações independentes usam start(), que limpa esse contexto HTTP.
  inspect(
    check: DeployCheck,
    category: Category = "divergência de configuração",
  ) {
    this.start(check, category, this.status);
  }

  async request(
    check: DeployCheck,
    operation: () => Promise<Response>,
    expectedStatus?: number,
  ) {
    this.start(check, "erro de rede");
    const response = await operation();
    this.status = httpStatus(response.status);
    this.category = (
      expectedStatus === undefined
        ? response.ok
        : response.status === expectedStatus
    )
      ? "resposta inesperada"
      : "falha HTTP";
    return response;
  }

  httpOk(response: Response) {
    this.category = "falha HTTP";
    assert.ok(response.ok);
    this.category = "resposta inesperada";
  }

  httpStatus(response: Response, expected: number) {
    this.category = "falha HTTP";
    assert.equal(response.status, expected);
    this.category = "resposta inesperada";
  }

  message(error: unknown) {
    const reason = classifyDeployError(error);
    const cause = reason === "UNKNOWN" ? "não detalhada" : reason;
    const cleanup =
      this.phase === "cleanup"
        ? " Limpeza privada incompleta. Não publique artifacts deste runner."
        : "";
    return `Deploy DEV não confirmado na etapa: ${phases[this.phase]}; verificação: ${checks[this.check]}; categoria: ${this.category}; status HTTP: ${this.status ?? "indisponível"}; causa técnica: ${cause}. Nenhuma repetição ou contratação automática. Confira o estado remoto antes de tentar novamente.${cleanup}`;
  }

  report(error: unknown, log: (message: string) => void = console.error) {
    try {
      const trackable =
        error !== null &&
        (typeof error === "object" || typeof error === "function");
      if (trackable && this.reported.has(error)) return;
      log(this.message(error));
      if (trackable) this.reported.add(error);
    } catch {
      // Inclusive falha do classificador/sink: nunca substituir a exceção original.
    }
  }
}
