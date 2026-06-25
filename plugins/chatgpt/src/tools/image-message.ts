import { ToolError, defineTool, waitUntil } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

const COMPOSER_SELECTOR = 'div#prompt-textarea[contenteditable="true"], [role="textbox"][contenteditable="true"]';
const FALLBACK_COMPOSER_SELECTOR = 'textarea#prompt-textarea, textarea[aria-label]';
const IMAGE_INPUT_SELECTOR = 'input#upload-photos[type="file"], input[type="file"][accept*="image"]';
const SEND_BUTTON_SELECTOR =
  'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="送信"], button[aria-label*="送信"], button[aria-label="プロンプトを送信する"]';
const STOP_BUTTON_SELECTOR =
  'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="回答を停止"], button[aria-label*="停止"]';

const imageInput = z.object({
  filename: z.string().min(1).describe('Image filename, for example "image.png"'),
  mime_type: z.string().min(1).describe('Image MIME type, for example "image/png"'),
  base64_content: z
    .string()
    .min(1)
    .describe('Base64-encoded image content. Data URLs are accepted; the prefix will be stripped.'),
});

const normalizeBase64 = (base64: string): string => {
  const commaIndex = base64.indexOf(',');
  return base64.startsWith('data:') && commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
};

const base64ToBytes = (base64: string): Uint8Array => {
  let binary: string;
  try {
    binary = atob(normalizeBase64(base64));
  } catch {
    throw ToolError.validation('Invalid base64_content. Provide raw base64 or a data URL.');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const findComposer = (): Element => {
  const composer = Array.from(document.querySelectorAll(COMPOSER_SELECTOR)).find(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  });
  if (composer) return composer;

  const fallbackComposer = Array.from(document.querySelectorAll(FALLBACK_COMPOSER_SELECTOR)).find(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  });
  if (fallbackComposer) return fallbackComposer;

  if (!composer) {
    throw ToolError.notFound('ChatGPT composer was not found. Open a conversation with the message box visible.');
  }
  return composer;
};

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

const waitForSendButton = async (timeout = 30_000): Promise<HTMLButtonElement | null> => {
  await waitUntil(() => findEnabledSendButton() !== null, { interval: 250, timeout }).catch(() => undefined);
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

const waitForComposerText = async (message: string): Promise<void> => {
  await waitUntil(
    () => {
      const composer = findComposer();
      return getComposerText(composer).trim() === message.trim();
    },
    { interval: 100, timeout: 5000 },
  );
};

const submitComposer = (composer: Element, sendButton: HTMLButtonElement): void => {
  const form = (sendButton ?? composer).closest('form');
  if (form instanceof HTMLFormElement) {
    form.requestSubmit(sendButton);
    return;
  }

  sendButton.click();
};

const uploadImageToComposer = async (image: z.infer<typeof imageInput>): Promise<number> => {
  if (!image.mime_type.startsWith('image/')) {
    throw ToolError.validation('mime_type must be an image MIME type.');
  }

  const input = document.querySelector<HTMLInputElement>(IMAGE_INPUT_SELECTOR);
  if (!input) {
    throw ToolError.notFound('ChatGPT image upload input was not found.');
  }

  const bytes = base64ToBytes(image.base64_content);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], image.filename, { type: image.mime_type });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);

  Object.defineProperty(input, 'files', {
    value: dataTransfer.files,
    configurable: true,
  });

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // ChatGPT enables the send button only after the attachment is accepted.
  const sendButton = await waitForSendButton();
  if (!sendButton) {
    throw ToolError.timeout('ChatGPT send button did not become available after image upload.');
  }

  return file.size;
};

export const uploadImage = defineTool({
  name: 'upload_image',
  displayName: 'Upload Image',
  description:
    'Attach an image to the currently open ChatGPT conversation composer. The image is provided as base64 content.',
  summary: 'Attach an image to the composer',
  icon: 'image-up',
  group: 'Conversations',
  input: z.object({
    image: imageInput,
  }),
  output: z.object({
    uploaded: z.boolean().describe('Whether the image upload was started'),
    filename: z.string().describe('Uploaded filename'),
    size_bytes: z.number().describe('Image size in bytes'),
    conversation_url: z.string().describe('Current ChatGPT conversation URL'),
  }),
  handle: async params => {
    const sizeBytes = await uploadImageToComposer(params.image);
    return {
      uploaded: true,
      filename: params.image.filename,
      size_bytes: sizeBytes,
      conversation_url: location.href,
    };
  },
});

export const sendImageMessage = defineTool({
  name: 'send_image_message',
  displayName: 'Send Image Message',
  description:
    'Attach an image to the currently open ChatGPT conversation and send it with an optional message. The image is provided as base64 content.',
  summary: 'Send an image message',
  icon: 'send',
  group: 'Conversations',
  input: z.object({
    image: imageInput,
    message: z.string().optional().describe('Optional message text to send with the image'),
  }),
  output: z.object({
    sent: z.boolean().describe('Whether the message was submitted'),
    filename: z.string().describe('Uploaded filename'),
    size_bytes: z.number().describe('Image size in bytes'),
    conversation_url: z.string().describe('Current ChatGPT conversation URL'),
  }),
  handle: async params => {
    let composer = findComposer();
    if (composer instanceof HTMLElement) composer.focus();
    if (params.message) setComposerValue(composer, params.message);
    const sizeBytes = await uploadImageToComposer(params.image);

    // ChatGPT can re-render the composer while accepting an attachment, so set
    // the text again on the current composer and wait until React has accepted it.
    composer = findComposer();
    if (composer instanceof HTMLElement) composer.focus();
    if (params.message) {
      setComposerValue(composer, params.message);
      await waitForComposerText(params.message);
    }

    const sendButton = await waitForSendButton();
    if (!sendButton) {
      throw ToolError.timeout('ChatGPT send button did not become available after image upload.');
    }

    submitComposer(composer, sendButton);
    await waitUntil(() => isResponding() || isComposerEmpty(findComposer()), { interval: 250, timeout: 5000 }).catch(
      () => undefined,
    );

    return {
      sent: isResponding() || isComposerEmpty(findComposer()),
      filename: params.image.filename,
      size_bytes: sizeBytes,
      conversation_url: location.href,
    };
  },
});
