import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { attachToDraft, attachmentInputSchema } from '../attachments.js';
import { composeToolBody } from '../compose-defaults.js';
import { api } from '../outlook-api.js';

export const replyToMessage = defineTool({
  name: 'reply_to_message',
  displayName: 'Reply to Message',
  description:
    "Reply to an email message. By default the reply is sent immediately. Set draft to true to instead save a threaded draft to the Drafts folder for the user to review and send manually. Either way the original conversation is quoted, reply headers are set, and the user's default compose font and reply signature are applied automatically — do not write a signature into the body yourself. Set reply_all to true to reply to all recipients.",
  summary: 'Reply to an email',
  icon: 'reply',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('The message ID to reply to'),
    body: z.string().describe('Reply body content'),
    body_type: z
      .enum(['text', 'html'])
      .optional()
      .describe('Body content type (default: text). HTML is inserted as-is above the quoted thread.'),
    reply_all: z.boolean().optional().describe('Reply to all recipients (default: false)'),
    draft: z.boolean().optional().describe('Save as a threaded draft instead of sending immediately (default: false)'),
    include_signature: z.boolean().optional().describe("Append the user's reply signature (default: true)"),
    attachments: z.array(attachmentInputSchema).optional().describe('Files to attach to the reply'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation completed'),
    draft_id: z.string().optional().describe('Created draft message ID (only when draft is true)'),
    web_link: z.string().optional().describe('Link to open the draft in Outlook (only when draft is true)'),
  }),
  handle: async params => {
    // createReply/createReplyAll have the server build a draft with the original
    // conversation quoted, recipients pre-filled, and reply headers set. The action
    // takes no body, so the user's text — styled with the default font and reply
    // signature — is layered on top of the returned quoted history with a follow-up
    // PATCH (passing a body to the create action would replace the quote and lose the
    // thread). For an immediate reply the same composed draft is then sent; this keeps
    // the font/signature identical whether replying live or saving a draft.
    const draftAction = params.reply_all ? 'createReplyAll' : 'createReply';
    const draft = await api<{ id?: string; webLink?: string; body?: { content?: string } }>(
      `/me/messages/${params.message_id}/${draftAction}`,
      { method: 'POST' },
    );
    const draftId = draft.id;
    if (!draftId) throw ToolError.internal('Reply draft was created without a message id.');

    const quoted = draft.body?.content ?? '';
    const applyBody = async () => {
      const composed = await composeToolBody(params, 'reply');
      await api(`/me/messages/${draftId}`, {
        method: 'PATCH',
        body: { body: { contentType: 'HTML', content: `${composed.content}${quoted}` } },
      });
      await attachToDraft(draftId, params.attachments);
    };

    // Compose the reply onto the created draft. Any failure here means nothing was
    // sent, so delete the draft rather than leave an orphan — for both draft mode and
    // immediate send.
    try {
      await applyBody();
    } catch (err) {
      await api(`/me/messages/${draftId}`, { method: 'DELETE' }).catch(() => {});
      throw err;
    }

    if (params.draft) {
      return { success: true, draft_id: draftId, web_link: draft.webLink ?? '' };
    }

    // A failure of the send itself is ambiguous (the message may already be on its
    // way), so the draft is left in place rather than risk deleting a sent message.
    await api(`/me/messages/${draftId}/send`, { method: 'POST' });
    return { success: true };
  },
});
