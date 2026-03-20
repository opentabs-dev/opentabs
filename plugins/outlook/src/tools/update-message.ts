import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';

export const updateMessage = defineTool({
  name: 'update_message',
  displayName: 'Update Message',
  description: 'Update message properties like read status, importance, categories, or flag status.',
  summary: 'Update email properties',
  icon: 'pencil',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('The message ID to update'),
    is_read: z.boolean().optional().describe('Mark as read or unread'),
    importance: z.enum(['low', 'normal', 'high']).optional().describe('Set importance level'),
    categories: z.array(z.string()).optional().describe('Set categories/labels'),
    flag_status: z.enum(['notFlagged', 'flagged', 'complete']).optional().describe('Set flag status'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the update succeeded'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.is_read !== undefined) body.isRead = params.is_read;
    if (params.importance !== undefined) body.importance = params.importance;
    if (params.categories !== undefined) body.categories = params.categories;
    if (params.flag_status !== undefined) body.flag = { flagStatus: params.flag_status };

    await api(`/me/messages/${params.message_id}`, {
      method: 'PATCH',
      body,
    });
    return { success: true };
  },
});
