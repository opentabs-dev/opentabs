import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { encodeUrn, getMyProfileUrn, messagingGraphql } from '../linkedin-api.js';
import { mailboxCountSchema, mapMailboxCount } from './schemas.js';

/** Persisted query hash for mailbox counts — changes with LinkedIn deployments. */
const MAILBOX_COUNTS_QUERY_ID = 'messengerMailboxCounts.fc528a5a81a76dff212a4a3d2d48e84b';

interface MailboxCountsResponse {
  data?: {
    messengerMailboxCountsByMailbox?: {
      elements?: Array<Record<string, unknown>>;
    };
  };
}

export const getMailboxCounts = defineTool({
  name: 'get_mailbox_counts',
  displayName: 'Get Mailbox Counts',
  description:
    'Get unread message counts per mailbox category (Inbox, Secondary Inbox, Message Requests, Archive, Spam).',
  summary: 'Get unread message counts',
  icon: 'inbox',
  group: 'Messaging',
  input: z.object({}),
  output: z.object({
    counts: z.array(mailboxCountSchema).describe('Unread counts per mailbox category'),
  }),
  handle: async () => {
    const profileUrn = await getMyProfileUrn();

    const data = await messagingGraphql<MailboxCountsResponse>(
      MAILBOX_COUNTS_QUERY_ID,
      `(mailboxUrn:${encodeUrn(profileUrn)})`,
    );

    const elements = data.data?.messengerMailboxCountsByMailbox?.elements ?? [];
    const counts = elements.map(el => mapMailboxCount(el as Parameters<typeof mapMailboxCount>[0]));

    return { counts };
  },
});
