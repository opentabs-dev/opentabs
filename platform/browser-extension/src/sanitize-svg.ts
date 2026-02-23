/**
 * SVG sanitizer for plugin icons rendered via dangerouslySetInnerHTML.
 *
 * Uses an element/attribute allowlist approach — only known-safe SVG elements
 * and attributes are preserved. Everything else is stripped. This prevents XSS
 * vectors including <script>, <foreignObject>, event handler attributes,
 * javascript: URIs, and CSS-based attacks.
 *
 * Runs in the side panel context (browser DOM available) and is also testable
 * in Bun's test runner (no DOM dependency — pure string processing).
 */

// Elements allowed in plugin SVG icons (covers common icon shapes and styling)
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'g',
  'defs',
  'clippath',
  'mask',
  'lineargradient',
  'radialgradient',
  'stop',
  'text',
  'tspan',
  'use',
  'symbol',
  'title',
  'desc',
]);

// Attributes allowed on SVG elements (covers geometry, styling, transforms)
const ALLOWED_ATTRIBUTES = new Set([
  // Core SVG attributes
  'viewbox',
  'xmlns',
  'xmlns:xlink',
  'version',
  'id',
  'class',
  // Geometry
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2',
  'width',
  'height',
  'points',
  // Presentation
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'opacity',
  'color',
  'display',
  'visibility',
  // Text
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'text-anchor',
  'text-decoration',
  'dominant-baseline',
  'alignment-baseline',
  'letter-spacing',
  'word-spacing',
  'dx',
  'dy',
  'rotate',
  'textlength',
  'lengthadjust',
  // Transform and clipping
  'transform',
  'clip-path',
  'clip-rule',
  'mask',
  // Gradient-specific
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  // Use/href (validated separately for safe values)
  'href',
  'xlink:href',
  // Overflow/aspect
  'overflow',
  'preserveaspectratio',
  // Marker
  'marker-start',
  'marker-mid',
  'marker-end',
  // Filter (references only)
  'filter',
  'flood-color',
  'flood-opacity',
  // Style (validated separately for safe values)
  'style',
]);

/** Returns true if a URI value is a safe internal reference (e.g., #id, url(#id)). */
const isSafeUri = (value: string): boolean => {
  const trimmed = value.trim();
  // Internal fragment references are safe
  if (trimmed.startsWith('#')) return true;
  // Empty string is safe
  if (trimmed === '') return true;
  // Block javascript:, data:, and any other protocol URIs
  return false;
};

/** Returns true if a style attribute value contains only safe CSS properties. */
const isSafeStyle = (value: string): boolean => {
  // Block any url() references except #fragment
  const urlPattern = /url\s*\(\s*(?:["']?\s*)(.*?)(?:\s*["']?\s*)\)/gi;
  let urlMatch;
  while ((urlMatch = urlPattern.exec(value)) !== null) {
    const url = (urlMatch[1] ?? '').trim();
    if (!url.startsWith('#')) return false;
  }
  // Block expression(), -moz-binding, and behavior CSS properties
  if (/expression\s*\(/i.test(value)) return false;
  if (/-moz-binding/i.test(value)) return false;
  if (/behavior\s*:/i.test(value)) return false;
  // Block javascript: in any property value
  if (/javascript\s*:/i.test(value)) return false;
  return true;
};

/**
 * Tokenize an SVG string into a sequence of tags and text content.
 * Each tag token preserves the raw tag string for reconstruction.
 */
interface TagToken {
  type: 'open' | 'close' | 'self-closing';
  raw: string;
  tagName: string;
  attributes: Array<{ name: string; value: string; raw: string }>;
}

interface TextToken {
  type: 'text';
  content: string;
}

type Token = TagToken | TextToken;

/** Parse an attribute string like `key="value"` or `key='value'` or `key` */
const parseAttributes = (attrString: string): Array<{ name: string; value: string; raw: string }> => {
  const attrs: Array<{ name: string; value: string; raw: string }> = [];
  // Match: name="value", name='value', or standalone name
  const attrRegex = /([a-z][a-z0-9:_-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'))?/gi;
  let match;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const name = match[1] ?? '';
    const value = match[2] ?? match[3] ?? '';
    attrs.push({ name, value, raw: match[0] });
  }
  return attrs;
};

/** Tokenize SVG markup into tags and text */
const tokenize = (svg: string): Token[] => {
  const tokens: Token[] = [];
  // Match opening/closing/self-closing tags and comments
  const tagRegex =
    /<!--[\s\S]*?-->|<\/?([a-z][a-z0-9]*)((?:\s+[a-z][a-z0-9:_-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/gi;
  let lastIndex = 0;

  let tagMatch;
  while ((tagMatch = tagRegex.exec(svg)) !== null) {
    // Text content before this tag
    if (tagMatch.index > lastIndex) {
      tokens.push({ type: 'text', content: svg.slice(lastIndex, tagMatch.index) });
    }

    const raw = tagMatch[0];
    // Skip comments entirely
    if (raw.startsWith('<!--')) {
      lastIndex = tagRegex.lastIndex;
      continue;
    }

    const tagName = tagMatch[1] ?? '';
    const attrString = tagMatch[2] ?? '';
    const selfClosing = tagMatch[3] === '/';
    const isClosing = raw.startsWith('</');

    if (isClosing) {
      tokens.push({ type: 'close', raw, tagName, attributes: [] });
    } else if (selfClosing) {
      tokens.push({ type: 'self-closing', raw, tagName, attributes: parseAttributes(attrString) });
    } else {
      tokens.push({ type: 'open', raw, tagName, attributes: parseAttributes(attrString) });
    }

    lastIndex = tagRegex.lastIndex;
  }

  // Trailing text
  if (lastIndex < svg.length) {
    tokens.push({ type: 'text', content: svg.slice(lastIndex) });
  }

  return tokens;
};

/**
 * Reconstruct an SVG tag from allowed attributes only.
 * Returns the sanitized tag string.
 */
const buildTag = (
  tagName: string,
  attributes: Array<{ name: string; value: string }>,
  selfClosing: boolean,
): string => {
  const parts = [tagName];
  for (const attr of attributes) {
    // Double-quote the value, escaping any embedded quotes
    const escapedValue = attr.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    parts.push(`${attr.name}="${escapedValue}"`);
  }
  const inner = parts.join(' ');
  return selfClosing ? `<${inner}/>` : `<${inner}>`;
};

/**
 * Sanitize an SVG string by stripping all elements and attributes not on the allowlist.
 *
 * Returns the sanitized SVG string safe for use with dangerouslySetInnerHTML.
 * Returns an empty string for non-string or empty input.
 */
const sanitizeSvg = (svg: string): string => {
  if (!svg || typeof svg !== 'string') return '';

  const tokens = tokenize(svg);
  const result: string[] = [];

  // Track which elements are currently stripped (to strip their children too)
  let strippedDepth = 0;

  for (const token of tokens) {
    if (token.type === 'text') {
      if (strippedDepth === 0) {
        result.push(token.content);
      }
      continue;
    }

    const tagNameLower = token.tagName.toLowerCase();

    if (token.type === 'close') {
      if (strippedDepth > 0) {
        strippedDepth--;
        continue;
      }
      if (ALLOWED_ELEMENTS.has(tagNameLower)) {
        result.push(`</${token.tagName}>`);
      }
      continue;
    }

    // Open or self-closing tag
    if (!ALLOWED_ELEMENTS.has(tagNameLower)) {
      if (token.type === 'open') {
        strippedDepth++;
      }
      // Self-closing disallowed tags are just dropped
      continue;
    }

    if (strippedDepth > 0) {
      // Inside a stripped subtree — skip this element and its children
      if (token.type === 'open') {
        strippedDepth++;
      }
      continue;
    }

    // Filter attributes
    const safeAttrs: Array<{ name: string; value: string }> = [];
    for (const attr of token.attributes) {
      const attrNameLower = attr.name.toLowerCase();

      // Skip any event handler attributes (on*)
      if (attrNameLower.startsWith('on')) continue;

      // Skip attributes not on the allowlist
      if (!ALLOWED_ATTRIBUTES.has(attrNameLower)) continue;

      // Validate href/xlink:href — only allow internal fragment references
      if (attrNameLower === 'href' || attrNameLower === 'xlink:href') {
        if (!isSafeUri(attr.value)) continue;
      }

      // Validate style attribute content
      if (attrNameLower === 'style') {
        if (!isSafeStyle(attr.value)) continue;
      }

      safeAttrs.push({ name: attr.name, value: attr.value });
    }

    result.push(buildTag(token.tagName, safeAttrs, token.type === 'self-closing'));
  }

  return result.join('');
};

export { sanitizeSvg };
