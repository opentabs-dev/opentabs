import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import type { RHPaginated } from './schemas.js';
import { type RawNotification, mapNotification, notificationSchema } from './schemas.js';

export const listNotifications = defineTool({
  name: 'list_notifications',
  displayName: 'List Notifications',
  description: 'List recent account notifications including alerts, updates, and system messages.',
  summary: 'List recent notifications',
  icon: 'bell',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    notifications: z.array(notificationSchema).describe('List of notifications'),
  }),
  handle: async () => {
    const data = await api<RHPaginated<RawNotification>>('/midlands/notifications/stack/');
    const notifications = (data.results ?? []).map(mapNotification);
    return { notifications };
  },
});
