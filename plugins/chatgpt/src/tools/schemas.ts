import { z } from 'zod';

// --- User ---

export const userSchema = z.object({
  id: z.string().describe('User ID'),
  email: z.string().describe('Email address'),
  name: z.string().describe('Display name'),
  picture: z.string().describe('Avatar URL'),
  country: z.string().describe('Country code'),
  created: z.string().describe('Account creation timestamp'),
});

interface RawUser {
  id?: string;
  email?: string;
  name?: string;
  picture?: string;
  country?: string;
  created?: number;
}

export const mapUser = (u: RawUser) => ({
  id: u.id ?? '',
  email: u.email ?? '',
  name: u.name ?? '',
  picture: u.picture ?? '',
  country: u.country ?? '',
  created: u.created ? new Date(u.created * 1000).toISOString() : '',
});

// --- Conversation (list item) ---

export const conversationListItemSchema = z.object({
  id: z.string().describe('Conversation ID (UUID)'),
  title: z.string().describe('Conversation title'),
  create_time: z.string().describe('Created ISO 8601 timestamp'),
  update_time: z.string().describe('Last updated ISO 8601 timestamp'),
  is_archived: z.boolean().describe('Whether the conversation is archived'),
  is_starred: z.boolean().describe('Whether the conversation is starred'),
  gizmo_id: z.string().describe('GPT or project ID associated with the conversation, empty if none'),
  snippet: z.string().describe('Preview snippet of the conversation'),
});

export interface RawConversationListItem {
  id?: string;
  title?: string;
  create_time?: string;
  update_time?: string;
  is_archived?: boolean;
  is_starred?: boolean;
  gizmo_id?: string | null;
  snippet?: string | null;
}

export const mapConversationListItem = (c: RawConversationListItem) => ({
  id: c.id ?? '',
  title: c.title ?? '',
  create_time: c.create_time ?? '',
  update_time: c.update_time ?? '',
  is_archived: c.is_archived ?? false,
  is_starred: c.is_starred ?? false,
  gizmo_id: c.gizmo_id ?? '',
  snippet: c.snippet ?? '',
});

// --- Message ---

export const messageSchema = z.object({
  id: z.string().describe('Message ID'),
  role: z.string().describe('Author role: system, user, assistant, or tool'),
  content_type: z.string().describe('Content type (text, code, etc.)'),
  text: z.string().describe('Message text content'),
  model: z.string().describe('Model slug used for this message, empty if not applicable'),
  create_time: z.string().describe('Created ISO 8601 timestamp'),
});

export const messageSubmissionSchema = z.object({
  conversation_id: z.string().describe('Conversation ID (UUID) that received the message'),
  accepted: z.literal(true).describe('Whether the ChatGPT composer accepted the submission'),
});

interface RawMessage {
  id?: string;
  author?: { role?: string };
  content?: { content_type?: string; parts?: (string | Record<string, unknown>)[] };
  metadata?: { model_slug?: string };
  create_time?: number;
}

export const mapMessage = (m: RawMessage) => ({
  id: m.id ?? '',
  role: m.author?.role ?? '',
  content_type: m.content?.content_type ?? '',
  text: extractTextFromParts(m.content?.parts),
  model: m.metadata?.model_slug ?? '',
  create_time: m.create_time ? new Date(m.create_time * 1000).toISOString() : '',
});

const extractTextFromParts = (parts?: (string | Record<string, unknown>)[]): string => {
  if (!parts) return '';
  return parts
    .map(p => (typeof p === 'string' ? p : ''))
    .filter(Boolean)
    .join('\n');
};

// --- Model ---

export const modelSchema = z.object({
  slug: z.string().describe('Model identifier slug (e.g., "gpt-5", "auto")'),
  title: z.string().describe('Human-readable model name'),
  max_tokens: z.number().describe('Maximum token context window'),
  tags: z.array(z.string()).describe('Model capability tags'),
  enabled_tools: z.array(z.string()).describe('Enabled tool identifiers'),
});

interface RawModel {
  slug?: string;
  title?: string;
  max_tokens?: number;
  tags?: string[];
  enabled_tools?: string[];
}

export const mapModel = (m: RawModel) => ({
  slug: m.slug ?? '',
  title: m.title ?? '',
  max_tokens: m.max_tokens ?? 0,
  tags: m.tags ?? [],
  enabled_tools: m.enabled_tools ?? [],
});

// --- Memory ---

export const memorySchema = z.object({
  id: z.string().describe('Memory ID'),
  content: z.string().describe('Memory content text'),
  created_at: z.string().describe('Created ISO 8601 timestamp'),
  updated_at: z.string().describe('Updated ISO 8601 timestamp'),
});

interface RawMemory {
  id?: string;
  content?: string;
  created_at?: number;
  updated_at?: number;
}

export const mapMemory = (m: RawMemory) => ({
  id: m.id ?? '',
  content: m.content ?? '',
  created_at: m.created_at ? new Date(m.created_at * 1000).toISOString() : '',
  updated_at: m.updated_at ? new Date(m.updated_at * 1000).toISOString() : '',
});

// --- GPT (Gizmo) ---

export const gptSchema = z.object({
  id: z.string().describe('GPT ID'),
  name: z.string().describe('GPT display name'),
  description: z.string().describe('GPT description'),
  short_url: z.string().describe('Short URL for the GPT'),
  author_name: z.string().describe('Author display name'),
  num_interactions: z.number().describe('Number of interactions/conversations'),
  tags: z.array(z.string()).describe('GPT tags'),
  created_at: z.string().describe('Created ISO 8601 timestamp'),
  updated_at: z.string().describe('Updated ISO 8601 timestamp'),
});

interface RawGpt {
  id?: string;
  display?: { name?: string; description?: string };
  short_url?: string;
  author?: { display_name?: string };
  num_interactions?: number;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

export const mapGpt = (g: RawGpt) => ({
  id: g.id ?? '',
  name: g.display?.name ?? '',
  description: g.display?.description ?? '',
  short_url: g.short_url ?? '',
  author_name: g.author?.display_name ?? '',
  num_interactions: g.num_interactions ?? 0,
  tags: g.tags ?? [],
  created_at: g.created_at ?? '',
  updated_at: g.updated_at ?? '',
});

// --- Prompt Library Item ---

export const promptSchema = z.object({
  id: z.string().describe('Prompt ID'),
  title: z.string().describe('Prompt title'),
  description: z.string().describe('Prompt description'),
  prompt: z.string().describe('Prompt text template'),
  category: z.string().describe('Prompt category'),
});

interface RawPrompt {
  id?: string;
  title?: string;
  description?: string;
  prompt?: string;
  category?: string;
}

export const mapPrompt = (p: RawPrompt) => ({
  id: p.id ?? '',
  title: p.title ?? '',
  description: p.description ?? '',
  prompt: p.prompt ?? '',
  category: p.category ?? '',
});

// --- Conversation detail ---

export const conversationDetailSchema = z.object({
  id: z.string().describe('Conversation ID (UUID)'),
  title: z.string().describe('Conversation title'),
  create_time: z.string().describe('Created ISO 8601 timestamp'),
  update_time: z.string().describe('Last updated ISO 8601 timestamp'),
  is_archived: z.boolean().describe('Whether the conversation is archived'),
  is_starred: z.boolean().describe('Whether the conversation is starred'),
  default_model: z.string().describe('Default model slug used in this conversation'),
  messages: z.array(messageSchema).describe('Messages in the conversation (chronological order)'),
});

export interface RawConversationDetail {
  conversation_id?: string;
  title?: string;
  create_time?: number;
  update_time?: number;
  is_archived?: boolean;
  is_starred?: boolean;
  default_model_slug?: string | null;
  mapping?: Record<string, { message?: RawMessage; children?: string[] }>;
  current_node?: string;
}

export const mapConversationDetail = (c: RawConversationDetail) => {
  // Walk the message tree from current_node back to root to get the active branch
  const messages: ReturnType<typeof mapMessage>[] = [];
  if (c.mapping) {
    // Build parent map and collect the active thread by walking from current_node
    const parentMap = new Map<string, string>();
    for (const [nodeId, node] of Object.entries(c.mapping)) {
      if (node.children) {
        for (const childId of node.children) {
          parentMap.set(childId, nodeId);
        }
      }
    }

    // Walk from current_node to root
    const orderedNodeIds: string[] = [];
    let current = c.current_node;
    while (current) {
      orderedNodeIds.unshift(current);
      current = parentMap.get(current);
    }

    for (const nodeId of orderedNodeIds) {
      const node = c.mapping[nodeId];
      if (node?.message?.content?.parts && node.message.content.parts.length > 0) {
        const text = extractTextFromParts(node.message.content.parts);
        // Skip system messages with empty text and visually hidden messages
        if (text || node.message.author?.role !== 'system') {
          messages.push(mapMessage(node.message));
        }
      }
    }
  }

  return {
    id: c.conversation_id ?? '',
    title: c.title ?? '',
    create_time: c.create_time ? new Date(c.create_time * 1000).toISOString() : '',
    update_time: c.update_time ? new Date(c.update_time * 1000).toISOString() : '',
    is_archived: c.is_archived ?? false,
    is_starred: c.is_starred ?? false,
    default_model: c.default_model_slug ?? '',
    messages,
  };
};
