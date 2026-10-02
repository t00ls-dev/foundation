import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";

// Preserve real D1 execution while injecting failures at execution, not prepare.
export function faultD1Queries(
  binding: D1Database,
  fails: (sql: string) => boolean,
): D1Database {
  function statement(
    query: D1PreparedStatement,
    sql: string,
  ): D1PreparedStatement {
    return new Proxy(query, {
      get(target, property, receiver) {
        if (property === "bind")
          return (...values: unknown[]) =>
            statement(target.bind(...values), sql);
        if (property === "run")
          return () => {
            if (fails(sql))
              return Promise.reject(
                new Error("simulated D1 execution failure"),
              );
            return target.run();
          };
        if (property === "raw")
          return (...args: Parameters<D1PreparedStatement["raw"]>) => {
            if (fails(sql))
              return Promise.reject(
                new Error("simulated D1 execution failure"),
              );
            return target.raw(...args);
          };
        if (property === "all")
          return () => {
            if (fails(sql))
              return Promise.reject(
                new Error("simulated D1 execution failure"),
              );
            return target.all();
          };
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
  }
  return new Proxy(binding, {
    get(target, property, receiver) {
      if (property === "prepare")
        return (sql: string) => statement(target.prepare(sql), sql);
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

export async function createTestDatabase() {
  const miniflare = new Miniflare({
    d1Databases: ["DB"],
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
  });
  const binding = await miniflare.getD1Database("DB");
  return { miniflare, binding };
}

export async function applyMigrations(binding: D1Database, only?: string) {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql") && (!only || file === only))
    .sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    const statements = sql
      .replaceAll("--> statement-breakpoint", "")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await binding.batch(
      statements.map((statement) => binding.prepare(statement)),
    );
  }
}
