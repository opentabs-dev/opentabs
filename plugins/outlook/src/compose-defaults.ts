import { owsRequest } from './outlook-api.js';

/**
 * Applies the user's Outlook compose defaults — default font and signature — to
 * bodies the plugin creates, so plugin-authored drafts match what OWA's compose
 * surface produces. These are client-side OWA behaviors that Graph's mailboxSettings
 * does not expose; they are read from OWS gateway endpoints on the OWA origin.
 */

/**
 * OWA's default compose font family. There is no server-stored compose font *name* —
 * startup data carries only size/color/flags — so the family is OWA's client default
 * (the Aptos stack), matching what the compose surface renders.
 */
const DEFAULT_FONT_FAMILY = 'Aptos, Aptos_EmbeddedFont, Aptos_MSFontService, Calibri, Helvetica, sans-serif';
const DEFAULT_FONT_SIZE_PT = 12;
const DEFAULT_FONT_COLOR = '#000000';

/** 3- or 6-digit hex color, so a server value can't break out of the style attribute. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;

/**
 * OWA's rich-text compose font-size enum → point size — the classic Outlook/Word
 * font-size scale (1–7). `3 ⇒ 12 pt` is confirmed against the live compose surface;
 * values outside this range fall back to the 12 pt default.
 */
const FONT_SIZE_PT_BY_ENUM: Record<number, number> = {
  1: 8,
  2: 10,
  3: 12,
  4: 14,
  5: 18,
  6: 24,
  7: 36,
};

/** OWA compose font style bit flags (Microsoft rich-text convention). */
const FONT_FLAG_BOLD = 1;
const FONT_FLAG_ITALIC = 2;
const FONT_FLAG_UNDERLINE = 4;

/** Which signature a body should carry. */
export type SignatureKind = 'new' | 'reply' | 'none';

interface ComposeDefaults {
  fontFamily: string;
  fontSizePt: number;
  fontColor: string;
  fontFlags: number;
  /** Display name of the signature applied to new messages, or null if none set. */
  newSignatureName: string | null;
  /** Display name of the signature applied to replies/forwards, or null if none. */
  replySignatureName: string | null;
}

/** One entry from an OWS settings response. */
interface OwsSetting {
  name?: string;
  value?: string;
  secondaryKey?: string;
}

/** Relevant slice of the OWA startup-data response. */
interface StartupData {
  owaUserConfig?: {
    UserOptions?: {
      ComposeFontSize?: number;
      ComposeFontColor?: string;
      ComposeFontFlags?: number;
    };
  };
}

// Compose defaults are stable for the page's lifetime, so cache them for the tab
// session. A page reload (e.g. after the user edits a signature in OWA) refreshes.
let cachedDefaults: ComposeDefaults | null = null;
const signatureHtmlCache = new Map<string, string | null>();

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const textToHtml = (text: string): string => escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');

/** Read the signature display-name defaults (new-mail + reply/forward) from OWS. */
const readSignatureNames = async (): Promise<Pick<ComposeDefaults, 'newSignatureName' | 'replySignatureName'>> => {
  const settings = await owsRequest<OwsSetting[]>('/ows/v1/OutlookCloudSettings/settings/', {
    query: { settingname: 'roaming_signature_list,roaming_new_signature,roaming_reply_signature' },
  });

  // Field-name casing varies (roaming_new_signature vs Roaming_Reply_Signature), so
  // key the lookup case-insensitively.
  const byName = new Map<string, string>();
  for (const setting of settings ?? []) {
    if (setting.name && typeof setting.value === 'string') byName.set(setting.name.toLowerCase(), setting.value);
  }

  const nonEmpty = (value: string | undefined): string | null => (value && value.trim().length > 0 ? value : null);

  return {
    newSignatureName: nonEmpty(byName.get('roaming_new_signature')),
    replySignatureName: nonEmpty(byName.get('roaming_reply_signature')),
  };
};

type UserOptions = NonNullable<NonNullable<StartupData['owaUserConfig']>['UserOptions']>;

/** Read the default compose font (size/color/flags) from OWA startup data. */
const readFont = async (): Promise<Pick<ComposeDefaults, 'fontFamily' | 'fontSizePt' | 'fontColor' | 'fontFlags'>> => {
  let options: UserOptions | undefined;
  try {
    const data = await owsRequest<StartupData>('/owa/startupdata.ashx', {
      method: 'POST',
      query: { app: 'Mail', n: 0 },
      headers: { action: 'StartupData', 'x-owa-actionsource': 'StartupData', 'x-req-source': 'Mail' },
    });
    options = data?.owaUserConfig?.UserOptions;
  } catch {
    options = undefined;
  }

  const sizeEnum = options?.ComposeFontSize;
  const fontSizePt = (typeof sizeEnum === 'number' && FONT_SIZE_PT_BY_ENUM[sizeEnum]) || DEFAULT_FONT_SIZE_PT;
  const composeFontColor = options?.ComposeFontColor?.trim();
  const fontColor =
    composeFontColor && HEX_COLOR_PATTERN.test(composeFontColor) ? composeFontColor : DEFAULT_FONT_COLOR;
  const fontFlags = typeof options?.ComposeFontFlags === 'number' ? options.ComposeFontFlags : 0;

  return { fontFamily: DEFAULT_FONT_FAMILY, fontSizePt, fontColor, fontFlags };
};

/**
 * Resolve (and cache) the user's compose defaults. The font lookup degrades to
 * defaults on failure, but the signature-name lookup propagates whatever `owsRequest`
 * throws (auth, rate-limit, non-OK, or network), so callers that must not fail — like
 * `composeBody` — guard the call.
 */
const getComposeDefaults = async (): Promise<ComposeDefaults> => {
  if (cachedDefaults) return cachedDefaults;
  const [names, font] = await Promise.all([readSignatureNames(), readFont()]);
  cachedDefaults = { ...font, ...names };
  return cachedDefaults;
};

/**
 * Fetch a signature's HTML body (with its logo inlined as a data-URI) by display
 * name. Returns null when the signature has no HTML body. Requires the
 * `x-islargesetting: true` header — signature bodies live in OWS's large-settings
 * collection, and without it the gateway 404s.
 */
const getSignatureHtml = async (displayName: string): Promise<string | null> => {
  const key = displayName.toLowerCase();
  const cached = signatureHtmlCache.get(key);
  if (cached !== undefined) return cached;

  const items = await owsRequest<OwsSetting[]>('/ows/v1/OutlookCloudSettings/settings/account', {
    query: { settingname: displayName },
    headers: { 'x-islargesetting': 'true' },
  });

  const html = items?.find(item => item.secondaryKey === 'htm')?.value;
  const result = typeof html === 'string' && html.length > 0 ? html : null;
  signatureHtmlCache.set(key, result);
  return result;
};

/** Wrap body HTML in the default-font div OWA applies to the compose surface. */
const wrapInDefaultFont = (html: string, defaults: ComposeDefaults): string => {
  const styles = [
    `font-family: ${defaults.fontFamily}`,
    `font-size: ${defaults.fontSizePt}pt`,
    `color: ${defaults.fontColor}`,
  ];
  if (defaults.fontFlags & FONT_FLAG_BOLD) styles.push('font-weight: bold');
  if (defaults.fontFlags & FONT_FLAG_ITALIC) styles.push('font-style: italic');
  if (defaults.fontFlags & FONT_FLAG_UNDERLINE) styles.push('text-decoration: underline');
  return `<div style="${styles.join('; ')}">${html}</div>`;
};

/** An HTML email body ready to send to the Graph/Outlook draft APIs. */
export interface ComposedBody {
  contentType: 'HTML';
  content: string;
}

/**
 * Compose an HTML email body with the user's default compose font and (optionally)
 * their Outlook signature applied — matching what OWA's compose surface produces.
 * Plain-text input is escaped and wrapped in the default-font div; HTML input is
 * kept as-is (assumed already styled by the caller). The signature, with its inline
 * data-URI images, is appended below the body. Degrades gracefully: if compose
 * defaults or the signature can't be fetched, the body is still returned as safe
 * HTML — a draft is never blocked on fetching a signature.
 */
export const composeBody = async (input: {
  body: string;
  bodyType: 'text' | 'html';
  signature: SignatureKind;
}): Promise<ComposedBody> => {
  const bodyHtml = input.bodyType === 'html' ? input.body : textToHtml(input.body);

  let defaults: ComposeDefaults | null = null;
  try {
    defaults = await getComposeDefaults();
  } catch {
    defaults = null;
  }

  // Only synthesize the default font for plain-text input; HTML input is trusted to
  // carry its own styling.
  const styledBody = defaults && input.bodyType === 'text' ? wrapInDefaultFont(bodyHtml, defaults) : bodyHtml;

  let signatureHtml: string | null = null;
  if (defaults && input.signature !== 'none') {
    const name = input.signature === 'new' ? defaults.newSignatureName : defaults.replySignatureName;
    if (name) {
      try {
        signatureHtml = await getSignatureHtml(name);
      } catch {
        signatureHtml = null;
      }
    }
  }

  const content = signatureHtml ? `${styledBody}<br>${signatureHtml}` : styledBody;
  return { contentType: 'HTML', content };
};

/**
 * Convenience wrapper over `composeBody` for the message tools: maps a tool's
 * `body_type` / `include_signature` inputs to compose options, applying the given
 * signature kind unless the caller opted out with `include_signature: false`.
 */
export const composeToolBody = (
  input: { body: string; body_type?: 'text' | 'html'; include_signature?: boolean },
  signatureKind: Exclude<SignatureKind, 'none'>,
): Promise<ComposedBody> =>
  composeBody({
    body: input.body,
    bodyType: input.body_type === 'html' ? 'html' : 'text',
    signature: input.include_signature === false ? 'none' : signatureKind,
  });
