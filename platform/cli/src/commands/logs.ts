/**
 * `opentabs logs` command — shows recent MCP server log output.
 *
 * The log file is written by `opentabs start` at ~/.opentabs/server.log
 * (or $OPENTABS_CONFIG_DIR/server.log).
 *
 * By default, prints the last N lines and exits. Use --follow / -f to
 * continuously tail new output (like `tail -f`).
 *
 * When --plugin <name> is specified, only lines containing [plugin:<name>]
 * are shown. This filters plugin log entries written by the MCP server's
 * onPluginLog handler.
 */

import { getLogFilePath } from '../config.js';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { existsSync, statSync, createReadStream, watch } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import type { Command } from 'commander';

interface LogsOptions {
  lines?: number;
  follow?: boolean;
  plugin?: string;
}

const DEFAULT_LINES = 50;

/** Read buffer size for reverse-seek tail (64KB bounds memory usage) */
const TAIL_BUFFER_SIZE = 64 * 1024;

/**
 * Read the last N lines from a file using a reverse-seek approach.
 * Reads at most TAIL_BUFFER_SIZE bytes from the end instead of the entire file.
 * Returns the tail content as a string and the file size (for follow offset).
 *
 * When a filter string is provided, only lines containing that string are
 * included in the result. The line count applies to filtered lines.
 */
const tailFile = async (
  filePath: string,
  lineCount: number,
  filter?: string,
): Promise<{ content: string; fileSize: number }> => {
  const fileSize = await stat(filePath).then(
    s => s.size,
    () => 0,
  );
  if (lineCount <= 0 || fileSize === 0) return { content: '', fileSize };
  const readStart = Math.max(0, fileSize - TAIL_BUFFER_SIZE);
  const fh = await open(filePath, 'r');
  let chunk: string;
  try {
    const length = fileSize - readStart;
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, readStart);
    chunk = buf.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await fh.close();
  }
  let lines = chunk.split('\n');
  // If we didn't read from the start, the first line may be partial — skip it
  if (readStart > 0) lines.shift();
  if (filter) {
    lines = lines.filter(line => line.includes(filter));
  }
  const tail = lines.slice(-lineCount);
  return { content: tail.join('\n'), fileSize };
};

/**
 * Follow (tail -f) a log file. Watches for changes and streams new content.
 * Returns a promise that never resolves (runs until the process exits).
 *
 * When a filter string is provided, only lines containing that string are
 * written to stdout. Partial lines at the end of a chunk are buffered until
 * the next read completes the line.
 */
const followFile = async (filePath: string, initialOffset: number, filter?: string): Promise<never> => {
  let offset = initialOffset;
  let reading = false;
  let readRequested = false;
  let partialLine = '';

  const readNewContent = (): void => {
    if (reading) {
      readRequested = true;
      return;
    }
    let currentSize: number;
    try {
      currentSize = statSync(filePath).size;
    } catch {
      // File was deleted (e.g., server restart removed old log) — skip this cycle
      return;
    }
    if (currentSize < offset) {
      // File was truncated (e.g., new server start) — read from beginning
      offset = 0;
      partialLine = '';
    }
    if (currentSize <= offset) return;
    reading = true;
    const stream = createReadStream(filePath, { start: offset, encoding: 'utf-8' });
    stream.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      if (!filter) {
        process.stdout.write(text);
        return;
      }
      // Filter mode: split into lines and only output matching ones
      const combined = partialLine + text;
      const lines = combined.split('\n');
      // Last element is either empty (if text ended with \n) or a partial line
      partialLine = lines.pop() ?? '';
      for (const line of lines) {
        if (line.includes(filter)) {
          process.stdout.write(line + '\n');
        }
      }
    });
    stream.on('end', () => {
      offset = currentSize;
      reading = false;
      if (readRequested) {
        readRequested = false;
        readNewContent();
      }
    });
    stream.on('error', () => {
      reading = false;
      if (readRequested) {
        readRequested = false;
        setTimeout(readNewContent, 100);
      }
    });
  };

  const watcher = watch(filePath, () => readNewContent());
  // Read immediately to catch content written between tailFile and watcher setup
  readNewContent();

  const cleanup = () => {
    watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  if (process.platform !== 'win32') {
    process.on('SIGTERM', cleanup);
  }

  return new Promise<never>(() => {
    // Runs forever until interrupted
  });
};

const parseLines = (value: string): number => {
  const parsedCount = Number(value);
  if (!Number.isInteger(parsedCount) || parsedCount < 0) {
    throw new InvalidArgumentError('Must be a non-negative integer.');
  }
  return parsedCount;
};

const handleLogs = async (options: LogsOptions): Promise<void> => {
  const logFilePath = getLogFilePath();

  if (!existsSync(logFilePath)) {
    console.error(pc.red('No log file found.'));
    console.error(pc.dim(`Expected at: ${logFilePath}`));
    console.error(pc.dim('Start the server with: opentabs start'));
    process.exit(1);
  }

  // Build the filter string for --plugin: match lines containing [plugin:<name>]
  const filter = options.plugin ? `[plugin:${options.plugin}]` : undefined;

  const lineCount = options.lines ?? DEFAULT_LINES;
  const { content, fileSize } = await tailFile(logFilePath, lineCount, filter);
  if (content) {
    process.stdout.write(content);
    if (!content.endsWith('\n')) process.stdout.write('\n');
  }

  if (options.follow === true) {
    await followFile(logFilePath, fileSize, filter);
  } else if (!content && options.plugin) {
    console.error(
      pc.dim(
        `No log output found for plugin "${options.plugin}". Check the plugin name or ensure the plugin has produced log output.`,
      ),
    );
  }
};

const registerLogsCommand = (program: Command): void => {
  program
    .command('logs')
    .description('Show recent MCP server log output')
    .option('--lines <n>', `Number of lines to show (default: ${DEFAULT_LINES})`, parseLines)
    .option('-f, --follow', 'Follow new output (like tail -f)')
    .option('--plugin <name>', 'Show only logs from a specific plugin')
    .addHelpText(
      'after',
      `
Examples:
  $ opentabs logs                       # Show last 50 lines and exit
  $ opentabs logs --lines 100           # Show last 100 lines and exit
  $ opentabs logs -f                    # Follow new output (like tail -f)
  $ opentabs logs -f --plugin slack     # Follow only Slack plugin logs`,
    )
    .action((options: LogsOptions) => handleLogs(options));
};

export { followFile, registerLogsCommand };
