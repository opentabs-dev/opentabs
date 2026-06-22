import { ToolError, defineTool, waitUntil } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

const COMPOSER_SELECTOR = 'div#prompt-textarea[contenteditable="true"], [role="textbox"][contenteditable="true"]';
const FALLBACK_COMPOSER_SELECTOR = 'textarea#prompt-textarea, textarea[aria-label]';
const SEND_BUTTON_SELECTOR =
  'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="送信"], button[aria-label*="送信"]';
const STOP_BUTTON_SELECTOR =
  'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="回答を停止"], button[aria-label*="停止"]';

const setComposerValue = (composer: Element, message: string): void => {
  if (composer instanceof HTMLTextAreaElement) {
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!nativeTextareaValueSetter) {
      composer.value = message;
    } else {
      nativeTextareaValueSetter.call(composer, message);
    }
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (composer instanceof HTMLElement && composer.isContentEditable) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    document.execCommand('insertText', false, message);
    composer.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: message,
      }),
    );
    return;
  }

  throw ToolError.internal('Unsupported ChatGPT composer element.');
};

const findEnabledSendButton = (): HTMLButtonElement | null => {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(SEND_BUTTON_SELECTOR));
  return buttons.find(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true') ?? null;
};

const waitForSendButton = async (): Promise<HTMLButtonElement | null> => {
  await waitUntil(() => findEnabledSendButton() !== null, { interval: 100, timeout: 3000 }).catch(() => undefined);
  return findEnabledSendButton();
};

const isComposerEmpty = (composer: Element): boolean => {
  if (composer instanceof HTMLTextAreaElement) return composer.value.trim() === '';
  return (composer.textContent ?? '').trim() === '';
};

const getComposerText = (composer: Element): string => {
  if (composer instanceof HTMLTextAreaElement) return composer.value;
  return composer.textContent ?? '';
};

const isResponding = (): boolean => document.querySelector(STOP_BUTTON_SELECTOR) !== null;

const findComposer = (): Element | null => {
  const visibleContentEditable = Array.from(document.querySelectorAll(COMPOSER_SELECTOR)).find(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  });
  if (visibleContentEditable) return visibleContentEditable;

  return (
    Array.from(document.querySelectorAll(FALLBACK_COMPOSER_SELECTOR)).find(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }) ?? null
  );
};

const waitForComposerText = async (message: string): Promise<void> => {
  await waitUntil(
    () => {
      const composer = findComposer();
      return composer !== null && getComposerText(composer).trim() === message.trim();
    },
    { interval: 100, timeout: 5000 },
  );
};

const submitWithEnter = (composer: Element): void => {
  const keyboardInit: KeyboardEventInit = {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
  };
  composer.dispatchEvent(new KeyboardEvent('keydown', keyboardInit));
  composer.dispatchEvent(new KeyboardEvent('keypress', keyboardInit));
  composer.dispatchEvent(new KeyboardEvent('keyup', keyboardInit));
};

const submitComposer = (composer: Element, sendButton: HTMLButtonElement | null): void => {
  const form = (sendButton ?? composer).closest('form');
  if (form instanceof HTMLFormElement) {
    form.requestSubmit(sendButton ?? undefined);
    return;
  }

  if (sendButton) {
    sendButton.click();
    return;
  }

  submitWithEnter(composer);
};

export const sendMessage = defineTool({
  name: 'send_message',
  displayName: 'Send Message',
  description:
    'Send a message in the currently open ChatGPT conversation by using the page composer. The target tab must already be on the desired conversation.',
  summary: 'Send a message to current conversation',
  icon: 'send',
  group: 'Conversations',
  input: z.object({
    message: z.string().min(1).describe('Message text to send'),
  }),
  output: z.object({
    sent: z.boolean().describe('Whether the message was submitted'),
    conversation_url: z.string().describe('Current ChatGPT conversation URL'),
  }),
  handle: async params => {
    const composer = findComposer();
    if (!composer) {
      throw ToolError.notFound('ChatGPT composer was not found. Open a conversation with the message box visible.');
    }

    if (composer instanceof HTMLElement) composer.focus();
    setComposerValue(composer, params.message);
    await waitForComposerText(params.message);

    const sendButton = await waitForSendButton();

    submitComposer(composer, sendButton);

    await waitUntil(() => isResponding() || isComposerEmpty(findComposer() ?? composer), {
      interval: 100,
      timeout: 5000,
    }).catch(() => undefined);

    return {
      sent: isResponding() || isComposerEmpty(findComposer() ?? composer),
      conversation_url: location.href,
    };
  },
});
