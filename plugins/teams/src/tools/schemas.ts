import { z } from 'zod';

// ---------------------------------------------------------------------------
// Conversation (chat) schema
// ---------------------------------------------------------------------------

export const conversationSchema = z.object({
  id: z.string().describe('Conversation/thread ID'),
  topic: z.string().describe('Chat name/topic (empty for unnamed 1:1 chats)'),
  type: z.string().describe('Conversation type (e.g., "Conversation")'),
  thread_type: z.string().describe('Thread type (e.g., "chat", "meeting", "space")'),
  member_count: z.string().describe('Number of members in the conversation'),
  created_at: z.string().describe('When the conversation was created (ISO 8601)'),
  last_message_content: z.string().describe('Content of the last message'),
  last_message_type: z.string().describe('Message type of the last message'),
  last_message_time: z.string().describe('Timestamp of the last message'),
  last_message_from: z.string().describe('Display name of the last message sender'),
  version: z.number().describe('Conversation version'),
});

export type Conversation = z.infer<typeof conversationSchema>;

interface RawConversation {
  id?: string;
  type?: string;
  threadProperties?: Record<string, unknown>;
  lastMessage?: Record<string, unknown>;
  version?: number;
}

export const mapConversation = (c: RawConversation): Conversation => ({
  id: c.id ?? '',
  topic: String(c.threadProperties?.topic ?? ''),
  type: c.type ?? '',
  thread_type: String(c.threadProperties?.threadType ?? ''),
  member_count: String(c.threadProperties?.memberCount ?? ''),
  created_at: String(c.threadProperties?.createdat ?? ''),
  last_message_content: String(c.lastMessage?.content ?? ''),
  last_message_type: String(c.lastMessage?.messagetype ?? ''),
  last_message_time: String(c.lastMessage?.composetime ?? ''),
  last_message_from: String(c.lastMessage?.imdisplayname ?? ''),
  version: typeof c.version === 'number' ? c.version : 0,
});

// ---------------------------------------------------------------------------
// Mention schema
// ---------------------------------------------------------------------------

const mentionSchema = z.object({
  mri: z.string().describe('Mentioned user MRI (e.g., "8:orgid:...")'),
  display_name: z.string().describe('Display name of the mentioned user'),
});

// ---------------------------------------------------------------------------
// File attachment schema
// ---------------------------------------------------------------------------

const fileSchema = z.object({
  title: z.string().describe('File name'),
  type: z.string().describe('File type (e.g., "image/png", "application/pdf")'),
  url: z.string().describe('File download URL'),
});

// ---------------------------------------------------------------------------
// Message schema
// ---------------------------------------------------------------------------

export const messageSchema = z.object({
  id: z.string().describe('Message ID (timestamp-based)'),
  client_message_id: z.string().describe('Client-assigned message ID'),
  content: z.string().describe('Message content (may contain HTML)'),
  message_type: z.string().describe('Message type (e.g., "RichText/Html", "Text")'),
  from: z.string().describe('Sender MRI (e.g., "8:orgid:username")'),
  display_name: z.string().describe('Sender display name'),
  compose_time: z.string().describe('When the message was composed (ISO 8601)'),
  conversation_id: z.string().describe('ID of the conversation this message belongs to'),
  mentions: z.array(mentionSchema).describe('Users mentioned in this message'),
  files: z.array(fileSchema).describe('Files attached to this message'),
  reactions: z.array(z.string()).describe('Reaction emoji keys on this message (e.g., ["like", "heart"])'),
});

export type Message = z.infer<typeof messageSchema>;

interface RawMention {
  mri?: string;
  displayName?: string;
}

interface RawFile {
  title?: string;
  type?: string;
  objectUrl?: string;
}

interface RawMessage {
  id?: string;
  clientmessageid?: string;
  content?: string;
  messagetype?: string;
  from?: string;
  imdisplayname?: string;
  composetime?: string;
  conversationid?: string;
  properties?: {
    mentions?: string;
    files?: string;
    emotions?: Array<{ key?: string }>;
  };
  annotationsSummary?: {
    emotions?: Array<{ key?: string }>;
  };
}

/** Extract the MRI (e.g., "8:live:username") from a full contact URL. */
const extractMri = (from: string): string => {
  const match = /\/contacts\/(.+)$/.exec(from);
  return match?.[1] ?? from;
};

/** Parse mentions from the serialized JSON string in properties.mentions. */
const parseMentions = (raw?: string): Array<{ mri: string; display_name: string }> => {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as RawMention[];
    return arr.map(m => ({ mri: m.mri ?? '', display_name: m.displayName ?? '' }));
  } catch {
    return [];
  }
};

/** Parse files from the serialized JSON string in properties.files. */
const parseFiles = (raw?: string): Array<{ title: string; type: string; url: string }> => {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as RawFile[];
    return arr.map(f => ({ title: f.title ?? '', type: f.type ?? '', url: f.objectUrl ?? '' }));
  } catch {
    return [];
  }
};

/** Extract unique reaction keys from emotions/annotationsSummary. */
const parseReactions = (msg: RawMessage): string[] => {
  const emotions = msg.properties?.emotions ?? msg.annotationsSummary?.emotions ?? [];
  const keys = new Set<string>();
  for (const e of emotions) {
    if (e.key) keys.add(e.key);
  }
  return [...keys];
};

export const mapMessage = (m: RawMessage): Message => ({
  id: m.id ?? '',
  client_message_id: m.clientmessageid ?? '',
  content: m.content ?? '',
  message_type: m.messagetype ?? '',
  from: extractMri(m.from ?? ''),
  display_name: m.imdisplayname ?? '',
  compose_time: m.composetime ?? '',
  conversation_id: m.conversationid ?? '',
  mentions: parseMentions(m.properties?.mentions),
  files: parseFiles(m.properties?.files),
  reactions: parseReactions(m),
});
