/**
 * Config schema migration framework.
 *
 * Migrations run automatically when loadConfig detects a config whose version
 * is older than CURRENT_CONFIG_VERSION. Each migration is a pure function that
 * receives a raw JSON object (Record<string, unknown>) and returns the migrated
 * object. Migrations operate on raw JSON — not the parsed OpentabsConfig type —
 * because old config shapes may not match the current interface.
 *
 * Before any migration runs, the original config.json is backed up to
 * config.json.backup. On failure, the backup is restored and the original
 * (unmigrated) config is returned so the server can still start.
 */

import { readFile } from 'node:fs/promises';
import { atomicWrite } from '@opentabs-dev/shared';
import { log } from './logger.js';

const CURRENT_CONFIG_VERSION = 2;

type MigrationFn = (config: Record<string, unknown>) => Record<string, unknown>;

/** Registry: target version → migration function */
const migrations: Map<number, MigrationFn> = new Map();

// v1 → v2: convert url-type setting strings to Record<string, string>
// (migration body added in US-003)
migrations.set(2, config => config);

/**
 * Run sequential config migrations from the config's current version up to
 * CURRENT_CONFIG_VERSION. Creates a backup before migrating; restores on failure.
 */
async function migrateConfig(configPath: string, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  const currentVersion =
    typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 1 ? raw.version : 1;

  if (currentVersion >= CURRENT_CONFIG_VERSION) {
    if (currentVersion > CURRENT_CONFIG_VERSION) {
      log.warn(`Config version ${currentVersion} is newer than supported ${CURRENT_CONFIG_VERSION} — loading as-is`);
    }
    return raw;
  }

  // Backup before migrating
  const backupPath = `${configPath}.backup`;
  const originalContent = await readFile(configPath, 'utf-8');
  await atomicWrite(backupPath, originalContent, 0o600);
  log.info(`Config backup created at ${backupPath}`);

  let migrated = structuredClone(raw);
  try {
    for (let v = currentVersion + 1; v <= CURRENT_CONFIG_VERSION; v++) {
      const fn = migrations.get(v);
      if (fn) {
        migrated = fn(migrated);
        log.info(`Config migrated from v${v - 1} to v${v}`);
      }
    }
    migrated.version = CURRENT_CONFIG_VERSION;

    // Persist migrated config
    await atomicWrite(configPath, `${JSON.stringify(migrated, null, 2)}\n`, 0o600);
    return migrated;
  } catch (err) {
    log.error('Config migration failed — restoring backup:', err);
    await atomicWrite(configPath, originalContent, 0o600);
    return raw;
  }
}

export { CURRENT_CONFIG_VERSION, migrateConfig };
