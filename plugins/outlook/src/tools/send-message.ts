import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { composeToolBody } from '../compose-defaults.js';
import { api } from '../outlook-api.js';

export const sendMessage = defineTool({
  name: 'send_message',
  displayName: 'Send Message',
  description:
    "Send a new email message. The user's default compose font and signature are applied automatically — do not write a signature into the body yourself. Supports plain text or HTML body, CC/BCC, and importance level.",
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
    include_signature: z.boolean().optional().describe("Append the user's signature (default: true)"),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the message was sent'),
  }),
  handle: async params => {
    const toRecipients = (addrs: string[]) => addrs.map(addr => ({ emailAddress: { address: addr } }));

    const body = await composeToolBody(params, 'new');

    await api('/me/sendMail', {
      method: 'POST',
      body: {
        message: {
          subject: params.subject,
          body: {
            contentType: body.contentType,
            content: body.content,
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
