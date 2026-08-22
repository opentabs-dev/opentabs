import { ToolError, getCurrentUrl, querySelectorAll, waitForSelector, waitUntil } from '@opentabs-dev/plugin-sdk';
import { api } from './chatgpt-api.js';
import { type RawConversationListItem, mapConversationListItem } from './tools/schemas.js';

interface RawProjectConversationPage {
  items?: RawConversationListItem[];
  cursor?: string | null;
}

export interface ProjectConversationPage {
  conversations: ReturnType<typeof mapConversationListItem>[];
  cursor: string;
}

interface SendConversationMessageOptions {
  conversationId: string;
  expectedProjectId: string;
  text: string;
}

interface ActiveConversationAddress {
  conversationId: string;
  isGlobalNewChat: boolean;
  isProjectHome: boolean;
  projectSegment: string;
}

const PROJECT_PAGE_LIMIT = 50;

const projectConversationsPath = (projectId: string): string =>
  `/gizmos/${encodeURIComponent(projectId)}/conversations`;

export const listProjectConversationPage = async (
  projectId: string,
  cursor = '0',
  limit = PROJECT_PAGE_LIMIT,
): Promise<ProjectConversationPage> => {
  const data = await api<RawProjectConversationPage>(projectConversationsPath(projectId), {
    query: {
      cursor,
      limit,
      owned_only: false,
    },
  });

  return {
    conversations: (data.items ?? []).map(mapConversationListItem),
    cursor: data.cursor ?? '',
  };
};

export const resolveProjectConversationByTitle = async (
  projectId: string,
  title: string,
): Promise<ReturnType<typeof mapConversationListItem>> => {
  const conversations = new Map<string, ReturnType<typeof mapConversationListItem>>();
  const seenCursors = new Set<string>();
  let cursor = '0';

  while (!seenCursors.has(cursor)) {
    seenCursors.add(cursor);
    const page = await listProjectConversationPage(projectId, cursor);
    for (const conversation of page.conversations) {
      if (conversation.id && conversation.title === title) {
        conversations.set(conversation.id, conversation);
      }
    }

    if (!page.cursor) break;
    cursor = page.cursor;
  }

  if (conversations.size === 0) {
    throw ToolError.notFound(`No conversation titled "${title}" exists in project ${projectId}.`);
  }

  if (conversations.size > 1) {
    throw ToolError.validation(
      `Project ${projectId} contains ${conversations.size} conversations titled "${title}"; use a conversation ID to disambiguate.`,
    );
  }

  const conversation = conversations.values().next().value;
  if (!conversation) {
    throw ToolError.internal('Conversation resolution produced no result.');
  }
  return conversation;
};

const getActiveConversationAddress = (): ActiveConversationAddress => {
  const url = new URL(getCurrentUrl());
  const segments = url.pathname.split('/').filter(Boolean);
  const conversationMarker = segments.lastIndexOf('c');
  const projectMarker = segments.indexOf('g');

  return {
    conversationId: conversationMarker >= 0 ? (segments[conversationMarker + 1] ?? '') : '',
    isGlobalNewChat: segments.length === 0,
    isProjectHome: projectMarker === 0 && segments[2] === 'project' && segments.length === 3,
    projectSegment: projectMarker >= 0 ? (segments[projectMarker + 1] ?? '') : '',
  };
};

const matchesProjectId = (projectSegment: string, projectId: string): boolean =>
  projectSegment === projectId || projectSegment.startsWith(`${projectId}-`);

const isGenerating = (): boolean => querySelectorAll<HTMLElement>('[data-testid="stop-button"]').length > 0;

const getSendButton = (): HTMLButtonElement | undefined =>
  querySelectorAll<HTMLButtonElement>('[data-testid="send-button"]')[0];

const getComposer = async (): Promise<HTMLElement> => {
  if (isGenerating()) {
    throw ToolError.validation(
      'The selected ChatGPT composer is currently generating a response; no message was sent.',
    );
  }

  const composer = await waitForSelector<HTMLElement>('#prompt-textarea', { timeout: 5_000 });
  if (composer.textContent?.trim()) {
    throw ToolError.validation('The selected ChatGPT composer contains an unsent draft; no message was sent.');
  }
  return composer;
};

const ensureSafeComposerState = async (conversationId: string, expectedProjectId: string): Promise<HTMLElement> => {
  const active = getActiveConversationAddress();
  if (active.conversationId !== conversationId) {
    throw ToolError.validation(
      `The selected ChatGPT tab is showing conversation ${active.conversationId || 'none'}, not ${conversationId}. Target an open tab for the resolved conversation and retry.`,
    );
  }
  if (!matchesProjectId(active.projectSegment, expectedProjectId)) {
    throw ToolError.validation(
      `The selected ChatGPT tab is not showing project ${expectedProjectId}. Target that project's conversation tab and retry.`,
    );
  }
  return getComposer();
};

const insertComposerText = (composer: HTMLElement, text: string): void => {
  composer.focus();
  const selection = globalThis.getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection?.removeAllRanges();
  selection?.addRange(range);

  if (!document.execCommand('insertText', false, text) || !composer.textContent?.trim()) {
    throw ToolError.internal('ChatGPT did not accept text in its composer; no message was sent.');
  }
};

const awaitSubmissionAccepted = async (composer: HTMLElement): Promise<void> => {
  try {
    await waitUntil(() => !composer.textContent?.trim(), { interval: 100, timeout: 5_000 });
  } catch {
    throw ToolError.internal(
      'ChatGPT submission was clicked, but the composer did not confirm acceptance. Inspect the conversation before retrying to avoid a duplicate message.',
    );
  }
};

const submitComposerMessage = async (composer: HTMLElement, text: string): Promise<void> => {
  insertComposerText(composer, text);
  await waitUntil(() => Boolean(getSendButton() && !getSendButton()?.disabled), {
    interval: 100,
    timeout: 5_000,
  });

  if (isGenerating()) {
    throw ToolError.validation('The target conversation started generating before the message could be sent.');
  }

  const sendButton = getSendButton();
  if (!sendButton || sendButton.disabled) {
    throw ToolError.internal('ChatGPT did not expose an enabled send button; no message was sent.');
  }
  sendButton.click();

  await awaitSubmissionAccepted(composer);
};

const awaitCreatedConversationId = async (): Promise<string> => {
  let conversationId = '';
  try {
    await waitUntil(
      () => {
        conversationId = getActiveConversationAddress().conversationId;
        return Boolean(conversationId) && !conversationId.startsWith('WEB:');
      },
      { interval: 100, timeout: 10_000 },
    );
  } catch {
    throw ToolError.internal(
      'ChatGPT accepted the first message, but the tab did not expose the new conversation ID. Inspect the tab before retrying to avoid creating a duplicate conversation.',
    );
  }
  return conversationId;
};

const startFromCurrentComposer = async (text: string): Promise<string> => {
  const composer = await getComposer();
  await submitComposerMessage(composer, text);
  return awaitCreatedConversationId();
};

export const startConversation = async (text: string): Promise<string> => {
  const active = getActiveConversationAddress();
  if (!active.isGlobalNewChat) {
    const existingComposer = querySelectorAll<HTMLElement>('#prompt-textarea')[0];
    if (existingComposer?.textContent?.trim()) {
      throw ToolError.validation('The selected ChatGPT tab contains an unsent draft; no new conversation was opened.');
    }

    const newChatLink = querySelectorAll<HTMLAnchorElement>('a[data-testid="create-new-chat-button"][href="/"]')[0];
    if (!newChatLink) {
      throw ToolError.internal('ChatGPT did not expose its New chat control; no conversation was created.');
    }
    newChatLink.click();

    try {
      await waitUntil(() => getActiveConversationAddress().isGlobalNewChat, { interval: 100, timeout: 5_000 });
    } catch {
      throw ToolError.internal('ChatGPT did not open its ordinary new-chat composer; no message was sent.');
    }
  }

  return startFromCurrentComposer(text);
};

export const startProjectConversation = async (projectId: string, text: string): Promise<string> => {
  const active = getActiveConversationAddress();
  if (!active.isProjectHome || !matchesProjectId(active.projectSegment, projectId)) {
    throw ToolError.validation(
      `The selected ChatGPT tab must show the new-chat page for project ${projectId}. Open /g/${projectId}/project in that tab and retry.`,
    );
  }

  const conversationId = await startFromCurrentComposer(text);
  const created = getActiveConversationAddress();
  if (!matchesProjectId(created.projectSegment, projectId)) {
    throw ToolError.internal(
      `ChatGPT created conversation ${conversationId}, but its URL no longer identifies project ${projectId}. Inspect the tab before retrying.`,
    );
  }
  return conversationId;
};

export const isConversationInProject = async (projectId: string, conversationId: string): Promise<boolean> => {
  const seenCursors = new Set<string>();
  let cursor = '0';

  while (!seenCursors.has(cursor)) {
    seenCursors.add(cursor);
    const page = await listProjectConversationPage(projectId, cursor);
    if (page.conversations.some(conversation => conversation.id === conversationId)) return true;
    if (!page.cursor) return false;
    cursor = page.cursor;
  }

  return false;
};

export const setConversationProject = async (conversationId: string, projectId: string): Promise<void> => {
  await api(`/conversation/${encodeURIComponent(conversationId)}`, {
    method: 'PATCH',
    body: { gizmo_id: projectId },
  });
};

export const awaitConversationInProject = async (projectId: string, conversationId: string): Promise<void> => {
  try {
    await waitUntil(() => isConversationInProject(projectId, conversationId), {
      interval: 250,
      timeout: 5_000,
    });
  } catch {
    throw ToolError.internal(
      `ChatGPT accepted the move for conversation ${conversationId}, but project ${projectId} did not confirm membership. Inspect the conversation before retrying.`,
    );
  }
};

export const sendCurrentConversationMessage = async ({
  conversationId,
  expectedProjectId,
  text,
}: SendConversationMessageOptions): Promise<void> => {
  const composer = await ensureSafeComposerState(conversationId, expectedProjectId);
  await submitComposerMessage(composer, text);
};
