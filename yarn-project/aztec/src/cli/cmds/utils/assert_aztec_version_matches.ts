import type { LogFn } from '@aztec/foundation/log';
import { getPackageVersion } from '@aztec/stdlib/update-checker';

import TOML from '@iarna/toml';
import { readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';

/** Warns if the `aztec` dependency tag in any crate's Nargo.toml doesn't match the CLI version. */
export async function assertAztecVersionMatches(log: LogFn): Promise<void> {
  const cliVersion = getPackageVersion();
  if (!cliVersion) {
    log(`WARNING: aztec CLI version not found. Skipping dependency compatibility check.`);
    return;
  }

  const expectedTag = `v${cliVersion}`;
  const mismatches: { file: string; tag: string }[] = [];

  const crateDirs = await collectCrateDirs('.');

  for (const dir of crateDirs) {
    const tomlPath = join(dir, 'Nargo.toml');
    let content: string;
    try {
      content = await readFile(tomlPath, 'utf-8');
    } catch {
      continue;
    }

    const parsed = TOML.parse(content) as Record<string, any>;
    const aztecDep = (parsed.dependencies as Record<string, any>)?.aztec;
    if (!aztecDep || typeof aztecDep !== 'object' || typeof aztecDep.tag !== 'string') {
      // If a dep called "aztec" doesn't exist or it does not get parsed to an object or it doesn't have a tag defined
      // we skip the check.
      continue;
    }

    if (aztecDep.tag !== expectedTag) {
      mismatches.push({ file: tomlPath, tag: aztecDep.tag });
    }
  }

  if (mismatches.length > 0) {
    const details = mismatches.map(m => `  ${m.file} (${m.tag})`).join('\n');
    log(
      `WARNING: Aztec dependency version mismatch detected.\n` +
        `The following crates have an aztec dependency that does not match the CLI version (${expectedTag}):\n` +
        `${details}\n\n` +
        `Run \`aztec update\` to update your dependencies.`,
    );
  }
}

/**
 * Recursively collects crate directories starting from startCrateDir by following path-based dependencies declared in
 * Nargo.toml files. Git-based deps are ignored (they only change when Nargo.toml itself is modified since the deps are
 * tagged).
 */
async function collectCrateDirs(startCrateDir: string): Promise<string[]> {
  // We have a set of visited dirs we check against when entering a new dir because we could stumble upon a directory
  // multiple times in case multiple deps shared a dep (e.g. dep A and dep B both sharing dep C).
  const visited = new Set<string>();

  async function visit(crateDir: string): Promise<void> {
    const absDir = resolve(crateDir);
    if (visited.has(absDir)) {
      return;
    }
    visited.add(absDir);

    // Every dep is its own crate and every crate needs to have Nargo.toml defined in the root so we try to load it and
    // error out if it's not the case.
    const tomlPath = join(absDir, 'Nargo.toml');
    const content = await readFile(tomlPath, 'utf-8').catch(() => {
      throw new Error(`Incorrectly defined dependency. Nargo.toml not found in ${absDir}`);
    });

    const parsed = TOML.parse(content) as Record<string, any>;

    const members = (parsed.workspace as Record<string, any>)?.members as string[] | undefined;

    if (Array.isArray(members)) {
      // The crate is a workspace root and has member defined so we visit the members
      for (const member of members) {
        const memberPath = resolve(absDir, member);
        await visit(memberPath);
      }
    } else {
      // The crate is not a workspace root so we check for dependencies
      const deps = (parsed.dependencies as Record<string, any>) ?? {};
      for (const dep of Object.values(deps)) {
        if (dep && typeof dep === 'object' && typeof dep.path === 'string') {
          const depPath = resolve(absDir, dep.path);
          const s = await stat(depPath);
          if (!s.isDirectory()) {
            throw new Error(
              `Dependency path "${dep.path}" in ${tomlPath} resolves to ${depPath} which is not a directory`,
            );
          }
          await visit(depPath);
        }
      }
    }
  }

  await visit(startCrateDir);
  return [...visited];
}
