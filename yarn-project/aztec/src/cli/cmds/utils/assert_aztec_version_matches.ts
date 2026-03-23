import type { LogFn } from '@aztec/foundation/log';
import { getPackageVersion } from '@aztec/stdlib/update-checker';

import TOML from '@iarna/toml';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { collectLocalCrateDirs } from './collect_local_crate_dirs.js';

/** Warns if the `aztec` dependency tag in any crate's Nargo.toml doesn't match the CLI version. */
export async function assertAztecVersionMatches(log: LogFn): Promise<void> {
  const cliVersion = getPackageVersion();
  if (!cliVersion) {
    log(`WARNING: aztec CLI version not found. Skipping dependency compatibility check.`);
    return;
  }

  const expectedTag = `v${cliVersion}`;
  const mismatches: { file: string; tag: string }[] = [];

  const crateDirs = await collectLocalCrateDirs('.');

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
