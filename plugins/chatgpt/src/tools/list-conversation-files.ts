import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../chatgpt-api.js';
import { isChatGPTContentUrl } from './file-download.js';

const fileReferenceSchema = z.object({
  file_id: z.string().describe('ChatGPT file ID'),
  content_url: z.string().describe('ChatGPT estuary content URL when present in the conversation payload'),
  message_id: z.string().describe('Message ID where this file reference was found'),
  role: z.string().describe('Author role of the source message'),
  name: z.string().describe('File name when present in metadata'),
  mime_type: z.string().describe('MIME type when present in metadata'),
  source_path: z.string().describe('Path inside the raw conversation payload where the reference was found'),
});

interface RawConversationNode {
  message?: {
    id?: string;
    author?: { role?: string };
  };
}

const FILE_ID_PATTERN = /file_[A-Za-z0-9]+/g;
const CONTENT_URL_PATTERN = /https:\/\/chatgpt\.com\/backend-api\/estuary\/content\?[^"'\s)]+/g;

const findStringMatches = (value: string): Array<{ fileId: string; contentUrl: string }> => {
  const matches: Array<{ fileId: string; contentUrl: string }> = [];
  for (const urlMatch of value.matchAll(CONTENT_URL_PATTERN)) {
    const contentUrl = urlMatch[0] ?? '';
    const fileId = new URL(contentUrl).searchParams.get('id') ?? '';
    if (fileId) matches.push({ fileId, contentUrl });
  }

  for (const idMatch of value.matchAll(FILE_ID_PATTERN)) {
    const fileId = idMatch[0] ?? '';
    if (fileId) matches.push({ fileId, contentUrl: '' });
  }

  return matches;
};

const nearbyString = (value: unknown, keys: string[]): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string') return candidate;
  }
  return '';
};

const walk = (
  value: unknown,
  path: string,
  context: { messageId: string; role: string },
  refs: Map<string, z.infer<typeof fileReferenceSchema>>,
): void => {
  if (typeof value === 'string') {
    for (const match of findStringMatches(value)) {
      const key = match.contentUrl || match.fileId;
      const existing = refs.get(key);
      refs.set(key, {
        file_id: match.fileId,
        content_url: match.contentUrl,
        message_id: existing?.message_id || context.messageId,
        role: existing?.role || context.role,
        name: existing?.name || '',
        mime_type: existing?.mime_type || '',
        source_path: existing?.source_path || path,
      });
    }
    return;
  }

  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}[${index}]`, context, refs);
    });
    return;
  }

  const record = value as Record<string, unknown>;
  const messageId =
    typeof record.id === 'string' && (path.endsWith('.message') || path === 'message') ? record.id : context.messageId;
  const role =
    typeof record.author === 'object' &&
    record.author !== null &&
    typeof (record.author as { role?: unknown }).role === 'string'
      ? (record.author as { role: string }).role
      : context.role;

  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'string') {
      const directFileId =
        key === 'file_id' || key === 'id' || key === 'asset_pointer' ? child.match(FILE_ID_PATTERN)?.[0] : null;
      const directContentUrl = key === 'url' && isChatGPTContentUrl(child) ? child : '';
      if (directFileId || directContentUrl) {
        const fileId = directFileId ?? new URL(directContentUrl).searchParams.get('id') ?? '';
        const dedupeKey = directContentUrl || fileId;
        refs.set(dedupeKey, {
          file_id: fileId,
          content_url: directContentUrl,
          message_id: messageId,
          role,
          name: nearbyString(record, ['name', 'filename', 'file_name']),
          mime_type: nearbyString(record, ['mime_type', 'mimeType', 'content_type', 'contentType']),
          source_path: `${path}.${key}`,
        });
      }
    }

    walk(child, path ? `${path}.${key}` : key, { messageId, role }, refs);
  }
};

export const listConversationFiles = defineTool({
  name: 'list_conversation_files',
  displayName: 'List Conversation Files',
  description:
    'List file and generated-image references found in a ChatGPT conversation raw payload. Use returned file IDs or content URLs with get_file_content or download_file.',
  summary: 'List files in a conversation',
  icon: 'images',
  group: 'Files',
  input: z.object({
    conversation_id: z.string().describe('Conversation ID (UUID)'),
  }),
  output: z.object({
    files: z.array(fileReferenceSchema).describe('File references found in the conversation'),
  }),
  handle: async params => {
    const data = await api<Record<string, unknown>>(`/conversation/${params.conversation_id}`);
    const refs = new Map<string, z.infer<typeof fileReferenceSchema>>();
    const mapping =
      data.mapping && typeof data.mapping === 'object' ? (data.mapping as Record<string, RawConversationNode>) : {};

    for (const [nodeId, node] of Object.entries(mapping)) {
      walk(
        node.message,
        `mapping.${nodeId}.message`,
        {
          messageId: node.message?.id ?? '',
          role: node.message?.author?.role ?? '',
        },
        refs,
      );
    }

    return { files: Array.from(refs.values()) };
  },
});
