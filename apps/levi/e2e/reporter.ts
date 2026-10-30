import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";

// Não serializa requests, erros originais, screenshots ou traces com links.
export default class SafeReporter implements Reporter {
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
  }
}
