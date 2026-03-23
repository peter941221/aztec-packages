import TOML from '@iarna/toml';
import { readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';

/**
 * Recursively collects crate directories starting from startCrateDir by following path-based dependencies declared in
 * Nargo.toml files. Git-based deps are ignored (they only change when Nargo.toml itself is modified since the deps are
 * tagged).
 */
export async function collectLocalCrateDirs(startCrateDir: string): Promise<string[]> {
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
