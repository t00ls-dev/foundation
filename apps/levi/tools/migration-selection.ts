import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Deliberadamente fechado: novas revisões exigem classificação operacional.
const allowed = [
  "0000_onboarding",
  "0001_abuse-limits",
  "0002_membros",
  "0003_protecao-update-runtime",
  "0004_interface-e-edicao",
  "0005_administracao-global",
  "0006_recibo-bootstrap-permanente",
  "0007_igrejas-expand",
  "0008_convites-igreja",
];

export function migrationSelection(args: string[]): string | null {
  if (args.length === 1 && args[0] === "--status") return null;
  assert.equal(args.length, 2, "Selecione uma revisão com --through TAG.");
  assert.equal(args[0], "--through");
  const tag = args[1];
  assert.ok(tag && allowed.includes(tag), "Revisão não classificada.");
  return tag;
}

export async function selectedMigrationFolder(
  tag: string,
  pending: readonly string[],
) {
  // Uma revisão por autorização; nenhum lote implícito ou rerun silencioso.
  assert.equal(pending[0], tag, "A revisão deve ser a primeira pendente.");
  const journal: unknown = JSON.parse(
    await readFile("migrations/meta/_journal.json", "utf8"),
  );
  assert.ok(journal && typeof journal === "object" && "entries" in journal);
  assert.ok(Array.isArray(journal.entries));
  const index = allowed.indexOf(tag);
  assert.ok(index >= 0);
  const entries: unknown[] = journal.entries.slice(0, index + 1);
  assert.equal(entries.length, index + 1);
  for (const [i, entry] of entries.entries()) {
    assert.ok(entry && typeof entry === "object" && "tag" in entry);
    assert.equal(entry.tag, allowed[i]);
  }
  const folder = await mkdtemp(join(tmpdir(), "levi-migration-"));
  try {
    await mkdir(join(folder, "meta"));
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    for (const name of allowed.slice(0, index + 1))
      await copyFile(`migrations/${name}.sql`, join(folder, `${name}.sql`));
    return folder;
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}
