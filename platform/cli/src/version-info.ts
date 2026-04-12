import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = dirname(fileURLToPath(import.meta.url));

export const getCliVersion = async (): Promise<string> => {
  const pkgPath = join(cliDir, '..', '..', 'package.json');
  const pkgJson = JSON.parse(await readFile(pkgPath, 'utf-8')) as { version: string };
  return pkgJson.version;
};

export const getMcpServerVersion = async (): Promise<string | null> => {
  try {
    let pkgPath: string;
    try {
      pkgPath = fileURLToPath(import.meta.resolve('@opentabs-dev/mcp-server/package.json'));
    } catch {
      pkgPath = join(cliDir, '..', '..', '..', 'mcp-server', 'package.json');
    }
    const pkgJson = JSON.parse(await readFile(pkgPath, 'utf-8')) as { version: string };
    return pkgJson.version;
  } catch {
    return null;
  }
};
