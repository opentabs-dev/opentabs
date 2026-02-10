/**
 * File Store — a generic facility for adapters to stream large data to local files.
 *
 * Adapters run in the browser and cannot write to the local filesystem. When an
 * adapter needs to transfer large data (e.g. Snowflake query results with 1M+ rows),
 * it can POST chunks of text directly to the MCP server's /files endpoint, which
 * writes them to a temp file. The MCP tool then returns the file path to the AI agent,
 * which can read it with offset/limit without consuming context window.
 *
 * This module is service-agnostic — any adapter can use it for any data format
 * (JSONL, CSV, raw text, etc.).
 *
 * This module is transport-agnostic and uses only Node.js built-ins.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FILE_STORE_DIR = join(tmpdir(), 'opentabs-files');

interface FileSession {
  fileId: string;
  filePath: string;
  createdAt: number;
  bytesWritten: number;
}

type FileSessionInfo = Pick<FileSession, 'fileId' | 'filePath' | 'createdAt' | 'bytesWritten'>;

// Active file sessions, keyed by fileId
const sessions = new Map<string, FileSession>();

/**
 * Create a new file session. Returns a fileId and filePath that the adapter
 * can use with appendToFile. Optionally writes initial content.
 */
const createFileSession = async (
  prefix: string = 'data',
  extension: string = 'jsonl',
  initialContent: string = '',
): Promise<FileSessionInfo> => {
  await mkdir(FILE_STORE_DIR, { recursive: true });

  const fileId = randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = join(FILE_STORE_DIR, `${prefix}_${timestamp}_${fileId.slice(0, 8)}.${extension}`);

  await writeFile(filePath, initialContent, 'utf-8');

  const session: FileSession = {
    fileId,
    filePath,
    createdAt: Date.now(),
    bytesWritten: Buffer.byteLength(initialContent, 'utf-8'),
  };

  sessions.set(fileId, session);
  return {
    fileId: session.fileId,
    filePath: session.filePath,
    createdAt: session.createdAt,
    bytesWritten: session.bytesWritten,
  };
};

/**
 * Append text content to an existing file session.
 */
const appendToFile = async (fileId: string, content: string): Promise<{ bytesWritten: number }> => {
  const session = sessions.get(fileId);
  if (!session) throw new Error(`File session not found: ${fileId}`);

  await appendFile(session.filePath, content, 'utf-8');
  session.bytesWritten += Buffer.byteLength(content, 'utf-8');

  return { bytesWritten: session.bytesWritten };
};

/**
 * Get metadata about a file session.
 */
const getFileSession = (fileId: string): FileSessionInfo | undefined => {
  const session = sessions.get(fileId);
  if (!session) return undefined;
  return {
    fileId: session.fileId,
    filePath: session.filePath,
    createdAt: session.createdAt,
    bytesWritten: session.bytesWritten,
  };
};

export { createFileSession, appendToFile, getFileSession };
export type { FileSessionInfo };
