import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { projectName } from "./project-name.js";

export const PRESET = "basic-d1";

export interface GenerateOptions {
  cwd?: string;
}

export interface GeneratedApp {
  name: string;
  target: string;
}

async function validateTarget(target: string): Promise<"empty" | "missing"> {
  if (target === parse(target).root) {
    throw new Error("Refusing to generate an app at a filesystem root.");
  }

  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) {
      throw new Error("Target directory must not be a symbolic link.");
    }
    if (!stats.isDirectory()) {
      throw new Error("Target path exists and is not a directory.");
    }
    if ((await readdir(target)).length > 0) {
      throw new Error("Target directory is not empty.");
    }
    return "empty";
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return "missing";
    }
    throw error;
  }
}

export async function generateApp(
  targetInput: string,
  options: GenerateOptions = {},
): Promise<GeneratedApp> {
  if (!targetInput.trim() || targetInput.includes("\0")) {
    throw new Error("A valid target directory is required.");
  }

  const target = resolve(options.cwd ?? process.cwd(), targetInput);
  const targetState = await validateTarget(target);
  const name = projectName(target);
  const template = fileURLToPath(
    new URL(`../templates/${PRESET}`, import.meta.url),
  );
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, ".create-app-"));

  try {
    await cp(template, staging, { recursive: true });

    for (const file of [
      "README.md",
      "package.json",
      ".dev.vars.example",
      "index.html",
      "src/client/app.tsx",
      "wrangler.jsonc",
    ]) {
      const path = resolve(staging, file);
      const contents = await readFile(path, "utf8");
      await writeFile(path, contents.replaceAll("__PROJECT_NAME__", name));
    }

    if (targetState === "empty") {
      try {
        await rmdir(target);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          ["EEXIST", "ENOTEMPTY"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        ) {
          throw new Error(
            "Target directory became non-empty during generation.",
            { cause: error },
          );
        }
        throw error;
      }
    }

    try {
      await rename(staging, target);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EEXIST", "ENOTEMPTY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        throw new Error(
          "Target directory became non-empty during generation.",
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  } finally {
    await rm(staging, { force: true, recursive: true });
  }

  return { name, target };
}
