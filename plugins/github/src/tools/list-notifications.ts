import { ToolError, fetchText } from '@opentabs-dev/plugin-sdk';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { isAuthenticated } from '../github-api.js';
import { notificationSchema } from './schemas.js';

export const listNotifications = defineTool({
  name: 'list_notifications',
  displayName: 'List Notifications',
  description: 'List notifications for the authenticated user. Includes issue, PR, and release notifications.',
  summary: 'List notifications for the authenticated user',
  icon: 'bell',
  group: 'Users',
  input: z.object({}),
  output: z.object({
    notifications: z.array(notificationSchema).describe('List of notifications'),
  }),
  handle: async () => {
    if (!isAuthenticated()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

    // Fetch the notifications page and parse from HTML
    const html = await fetchText('/notifications', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = doc.querySelectorAll('.notifications-list-item, .notification-list-item-link');
    const notifications = [];

    for (const item of items) {
      const titleEl = item.querySelector('.markdown-title, .notification-list-item-link');
      const repoEl = item.querySelector('.notification-list-item-repo, .text-small');
      const timeEl = item.querySelector('relative-time, time');
      const typeEl = item.querySelector('.type-icon');

      notifications.push({
        id: item.getAttribute('data-notification-id') ?? '',
        reason: '',
        unread: item.classList.contains('notification-unread'),
        subject_title: titleEl?.textContent?.trim() ?? '',
        subject_type: typeEl?.getAttribute('aria-label') ?? '',
        subject_url: '',
        repository_full_name: repoEl?.textContent?.trim() ?? '',
        updated_at: timeEl?.getAttribute('datetime') ?? '',
      });
    }

    return { notifications };
  },
});
