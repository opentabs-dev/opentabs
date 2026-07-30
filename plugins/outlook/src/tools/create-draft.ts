import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { attachToDraft, attachmentInputSchema } from '../attachments.js';
import { composeToolBody } from '../compose-defaults.js';
import { api } from '../outlook-api.js';

export const createDraft = defineTool({
  name: 'create_draft',
  displayName: 'Create Draft',
  description:
    "Create a draft for a brand-new, standalone email in the Drafts folder. The user's default compose font and signature are applied automatically — do not write a signature into the body yourself. The user can review and send it manually from Outlook. This does NOT thread onto an existing conversation — to draft a reply that quotes the original thread, use reply_to_message with draft set to true; to draft a forward, use forward_message with draft set to true.",
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
    include_signature: z
      .boolean()
      .optional()
      .describe("Append the user's Outlook signature to the draft (default: true)"),
    attachments: z.array(attachmentInputSchema).optional().describe('Files to attach to the draft'),
  }),
  output: z.object({
    draft_id: z.string().describe('The created draft message ID'),
    web_link: z.string().describe('Link to open the draft in Outlook'),
  }),
  handle: async params => {
    const toRecipients = (addrs: string[]) => addrs.map(addr => ({ emailAddress: { address: addr } }));

    const body = await composeToolBody(params, 'new');

    const data = await api<{ id: string; webLink?: string }>('/me/messages', {
      method: 'POST',
      body: {
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
    });

    if (params.attachments?.length) {
      const draftId = data.id;
      if (!draftId) throw ToolError.internal('Draft was created without a message id.');
      try {
        await attachToDraft(draftId, params.attachments);
      } catch (err) {
        // Keep create_draft atomic: a partial attach failure deletes the draft rather
        // than leave an orphan the caller never gets an id for.
        await api(`/me/messages/${draftId}`, { method: 'DELETE' }).catch(() => {});
        throw err;
      }
    }

    return {
      draft_id: data.id ?? '',
      web_link: data.webLink ?? '',
    };
  },
});
