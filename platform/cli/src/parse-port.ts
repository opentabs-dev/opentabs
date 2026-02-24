/**
 * Shared port parser and resolver for Commander options.
 */

import { DEFAULT_PORT, getEnv } from '@opentabs-dev/shared';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';

const parsePort = (value: string): number => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError('Must be an integer between 1 and 65535.');
  }
  return port;
};

/**
 * Resolves the MCP server port from (in priority order):
 * 1. The --port flag (passed via Commander options)
 * 2. The OPENTABS_PORT environment variable
 * 3. The default port (9515)
 */
const resolvePort = (options: { port?: number }): number => {
  if (options.port !== undefined) return options.port;

  const envPort = getEnv('OPENTABS_PORT');
  if (envPort !== undefined) {
    const parsed = Number(envPort);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed;
    }
    console.error(
      pc.yellow(
        `Warning: OPENTABS_PORT="${envPort}" is invalid (must be 1-65535). Using default port ${DEFAULT_PORT}.`,
      ),
    );
  }

  return DEFAULT_PORT;
};

export { parsePort, resolvePort };
