import { appendFileSync } from "node:fs";
import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
  FullConfig,
  Suite,
} from "@playwright/test/reporter";

// Não serializa requests, erros originais, screenshots ou traces com links.
export default class SafeReporter implements Reporter {
  private shard: FullConfig["shard"] = null;
  private testCount = 0;

  onBegin(config: FullConfig, suite: Suite) {
    this.shard = config.shard;
    this.testCount = suite.allTests().length;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    console.info(`${result.status}: ${test.titlePath().join(" / ")}`);
    if (result.status === "failed" || result.status === "timedOut") {
      for (const error of result.errors) {
        const source = error.stack?.match(
          /(?:onboarding\.spec|members\.spec|proxy\.spec|admin\.spec|layout\.spec|helpers)\.ts:\d+:\d+/,
        )?.[0];
        console.error(
          `Falha de asserção${source ? ` em ${source}` : " no navegador"}; detalhes sensíveis omitidos.`,
        );
      }
    }
  }
  onError() {
    console.error(
      "Falha na execução do navegador; nenhum detalhe sensível foi registrado.",
    );
  }
  onEnd(result: FullResult) {
    console.info(`Navegador: ${result.status}.`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (!summary) return;
    try {
      const shard = this.shard
        ? ` · shard ${this.shard.current}/${this.shard.total}`
        : "";
      appendFileSync(
        summary,
        `## Levi E2E${shard}\n\nTestes coletados: **${this.testCount}**.\n\nDuração: **${(result.duration / 1000).toFixed(1)} s**.\n\n`,
      );
    } catch {
      console.warn(
        "Resumo E2E indisponível; resultado do navegador preservado.",
      );
    }
  }
}
