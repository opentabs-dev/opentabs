import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { attachToDraft, attachmentInputSchema } from '../attachments.js';
import { composeToolBody } from '../compose-defaults.js';
import { api } from '../outlook-api.js';

export const sendMessage = defineTool({
  name: 'send_message',
  displayName: 'Send Message',
  description:
    "Send a new email message. The user's default compose font and signature are applied automatically — do not write a signature into the body yourself. Supports plain text or HTML body, CC/BCC, importance level, and file attachments. Note: when attachments are included the message is always filed in Sent Items (save_to_sent does not apply).",
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
    save_to_sent: z
      .boolean()
      .optional()
      .describe(
        'Save to Sent Items folder (default: true). Ignored when attachments are present — those are always saved.',
      ),
    include_signature: z.boolean().optional().describe("Append the user's signature (default: true)"),
    attachments: z.array(attachmentInputSchema).optional().describe('Files to attach to the message'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the message was sent'),
  }),
  handle: async params => {
    const toRecipients = (addrs: string[]) => addrs.map(addr => ({ emailAddress: { address: addr } }));

    const body = await composeToolBody(params, 'new');
    const message = {
      subject: params.subject,
      body: {
        contentType: body.contentType,
        content: body.content,
      },
      toRecipients: toRecipients(params.to),
      ccRecipients: params.cc ? toRecipients(params.cc) : undefined,
      bccRecipients: params.bcc ? toRecipients(params.bcc) : undefined,
      importance: params.importance,
    };

    // sendMail takes a message payload with no server-side id, so there is nothing to
    // attach files to. When attachments are present, create a draft, attach the files,
    // then send it — which always files the sent copy in Sent Items.
    if (params.attachments && params.attachments.length > 0) {
      const draft = await api<{ id?: string }>('/me/messages', { method: 'POST', body: message });
      const draftId = draft.id;
      if (!draftId) throw ToolError.internal('Draft was created without a message id.');

      try {
        await attachToDraft(draftId, params.attachments);
      } catch (err) {
        // Nothing was sent, so delete the partially-built draft rather than orphan it.
        await api(`/me/messages/${draftId}`, { method: 'DELETE' }).catch(() => {});
        throw err;
      }

      await api(`/me/messages/${draftId}/send`, { method: 'POST' });
      return { success: true };
    }

    await api('/me/sendMail', {
      method: 'POST',
      body: {
        message,
        saveToSentItems: params.save_to_sent ?? true,
      },
    });
    return { success: true };
  },
});
