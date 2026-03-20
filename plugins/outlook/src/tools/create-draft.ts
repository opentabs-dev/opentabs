import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';

export const createDraft = defineTool({
  name: 'create_draft',
  displayName: 'Create Draft',
  description:
    'Create a draft email message in the Drafts folder. The user can review and send it manually from Outlook.',
  summary: 'Create a draft email',
  icon: 'file-edit',
  group: 'Messages',
  input: z.object({
    to: z.array(z.string()).describe('Recipient email addresses'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body content'),
    body_type: z.enum(['text', 'html']).optional().describe('Body content type (default: text)'),
    cc: z.array(z.string()).optional().describe('CC recipient email addresses'),
    bcc: z.array(z.string()).optional().describe('BCC recipient email addresses'),
    importance: z.enum(['low', 'normal', 'high']).optional().describe('Importance level'),
  }),
  output: z.object({
    draft_id: z.string().describe('The created draft message ID'),
    web_link: z.string().describe('Link to open the draft in Outlook'),
  }),
  handle: async params => {
    const toRecipients = (addrs: string[]) => addrs.map(addr => ({ emailAddress: { address: addr } }));

    const data = await api<{ id: string; webLink?: string }>('/me/messages', {
      method: 'POST',
      body: {
        subject: params.subject,
        body: {
          contentType: params.body_type === 'html' ? 'HTML' : 'Text',
          content: params.body,
        },
        toRecipients: toRecipients(params.to),
        ccRecipients: params.cc ? toRecipients(params.cc) : undefined,
        bccRecipients: params.bcc ? toRecipients(params.bcc) : undefined,
        importance: params.importance,
      },
    });
    return {
      draft_id: data.id ?? '',
      web_link: data.webLink ?? '',
    };
  },
});
