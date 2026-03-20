import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';

export const sendMessage = defineTool({
  name: 'send_message',
  displayName: 'Send Message',
  description: 'Send a new email message. Supports plain text or HTML body, CC/BCC, and importance level.',
  summary: 'Send an email',
  icon: 'send',
  group: 'Messages',
  input: z.object({
    to: z.array(z.string()).describe('Recipient email addresses'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body content'),
    body_type: z.enum(['text', 'html']).optional().describe('Body content type (default: text)'),
    cc: z.array(z.string()).optional().describe('CC recipient email addresses'),
    bcc: z.array(z.string()).optional().describe('BCC recipient email addresses'),
    importance: z.enum(['low', 'normal', 'high']).optional().describe('Importance level (default: normal)'),
    save_to_sent: z.boolean().optional().describe('Save to Sent Items folder (default: true)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the message was sent'),
  }),
  handle: async params => {
    const toRecipients = (addrs: string[]) => addrs.map(addr => ({ emailAddress: { address: addr } }));

    await api('/me/sendMail', {
      method: 'POST',
      body: {
        message: {
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
        saveToSentItems: params.save_to_sent ?? true,
      },
    });
    return { success: true };
  },
});
