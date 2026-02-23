import { sanitizeSvg } from './sanitize-svg.js';
import { describe, expect, test } from 'bun:test';

describe('sanitizeSvg', () => {
  describe('safe SVG passthrough', () => {
    test('preserves a simple path icon', () => {
      const svg = '<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z" fill="#333"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves circles, rects, and ellipses', () => {
      const svg =
        '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#4F46E5"/><rect x="4" y="4" width="8" height="8" rx="2"/><ellipse cx="16" cy="16" rx="10" ry="5"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves gradients', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><defs><linearGradient id="g1"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#g1)"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves text elements', () => {
      const svg =
        '<svg viewBox="0 0 32 32"><text x="16" y="21" text-anchor="middle" fill="white" font-size="16" font-family="sans-serif">S</text></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves transforms', () => {
      const svg = '<svg viewBox="0 0 24 24"><g transform="translate(2,2)"><path d="M0 0h20v20H0z"/></g></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves stroke attributes', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><line x1="0" y1="0" x2="24" y2="24" stroke="#000" stroke-width="2" stroke-linecap="round"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves polyline and polygon', () => {
      const svg = '<svg viewBox="0 0 24 24"><polyline points="1,1 5,5 9,1"/><polygon points="12,2 22,22 2,22"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves clip-path references', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><defs><clippath id="c"><rect x="0" y="0" width="12" height="12"/></clippath></defs><circle cx="12" cy="12" r="10" clip-path="url(#c)"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves self-closing tags', () => {
      const svg = '<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves use with internal fragment reference', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><defs><symbol id="icon"><path d="M0 0h24v24H0z"/></symbol></defs><use href="#icon"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });
  });

  describe('XSS vector stripping', () => {
    test('strips <script> elements', () => {
      const svg = '<svg viewBox="0 0 24 24"><script>alert("xss")</script><path d="M12 2L2 22h20z"/></svg>';
      expect(sanitizeSvg(svg)).toBe('<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"/></svg>');
    });

    test('strips <foreignObject> elements and their children', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><div onclick="alert(1)">XSS</div></body></foreignObject><circle cx="12" cy="12" r="10"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('foreignObject');
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('alert');
      expect(result).toContain('<circle');
    });

    test('strips event handler attributes', () => {
      const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" onclick="alert(1)"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('onclick');
      expect(result).toContain('<circle');
    });

    test('strips onload event handler', () => {
      const svg = '<svg viewBox="0 0 24 24" onload="alert(1)"><path d="M0 0"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('onload');
      expect(result).not.toContain('alert');
    });

    test('strips onerror event handler', () => {
      const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" onerror="alert(1)"/></svg>';
      expect(sanitizeSvg(svg)).not.toContain('onerror');
    });

    test('strips javascript: URIs in href', () => {
      const svg = '<svg viewBox="0 0 24 24"><use href="javascript:alert(1)"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('javascript');
      expect(result).not.toContain('alert');
    });

    test('strips data: URIs in href', () => {
      const svg = '<svg viewBox="0 0 24 24"><use href="data:text/html,<script>alert(1)</script>"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('data:');
      expect(result).not.toContain('alert');
    });

    test('strips javascript: URIs in xlink:href', () => {
      const svg = '<svg viewBox="0 0 24 24"><use xlink:href="javascript:alert(1)"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('javascript');
    });

    test('strips external href on use elements', () => {
      const svg = '<svg viewBox="0 0 24 24"><use href="https://evil.com/xss.svg#icon"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('evil.com');
    });

    test('strips <image> elements', () => {
      const svg = '<svg viewBox="0 0 24 24"><image href="https://evil.com/tracker.png" width="24" height="24"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('image');
      expect(result).not.toContain('evil.com');
    });

    test('strips style attributes with javascript: URIs', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" style="background:javascript:alert(1)"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('javascript');
    });

    test('strips style attributes with expression()', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" style="width:expression(alert(1))"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('expression');
    });

    test('strips style attributes with external url() references', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" style="fill:url(https://evil.com/track)"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('evil.com');
    });

    test('preserves style attributes with internal url(#id) references', () => {
      const svg = '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" style="fill:url(#grad1)"/></svg>';
      expect(sanitizeSvg(svg)).toContain('url(#grad1)');
    });

    test('strips <animate> elements (not on allowlist)', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"><animate attributeName="r" values="10;20;10" dur="1s"/></circle></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('animate');
    });

    test('strips <set> elements', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"><set attributeName="fill" to="red" begin="click"/></circle></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('<set');
    });

    test('strips HTML comments', () => {
      const svg = '<svg viewBox="0 0 24 24"><!-- <script>alert(1)</script> --><path d="M0 0"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('<!--');
      expect(result).not.toContain('script');
    });

    test('strips nested malicious content inside foreignObject', () => {
      const svg =
        '<svg viewBox="0 0 24 24"><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('foreignObject');
      expect(result).not.toContain('iframe');
      expect(result).not.toContain('javascript');
    });

    test('strips <a> elements with href', () => {
      const svg = '<svg viewBox="0 0 24 24"><a href="javascript:alert(1)"><circle cx="12" cy="12" r="10"/></a></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('<a');
      expect(result).not.toContain('javascript');
    });

    test('preserves allowed elements after a stripped element containing allowed children', () => {
      const svg = '<svg><script><g></g></script><path d="M0,0"/></svg>';
      expect(sanitizeSvg(svg)).toBe('<svg><path d="M0,0"/></svg>');
    });

    test('strips script but preserves rect after it', () => {
      const svg = '<svg><script>alert(1)</script><rect width="10" height="10"/></svg>';
      expect(sanitizeSvg(svg)).toBe('<svg><rect width="10" height="10"/></svg>');
    });
  });

  describe('edge cases', () => {
    test('returns empty string for empty input', () => {
      expect(sanitizeSvg('')).toBe('');
    });

    test('returns empty string for null-ish input', () => {
      expect(sanitizeSvg(null as unknown as string)).toBe('');
      expect(sanitizeSvg(undefined as unknown as string)).toBe('');
    });

    test('handles SVG with no dangerous content unchanged', () => {
      const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="red"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('strips unknown attributes not on allowlist', () => {
      const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" data-evil="yes"/></svg>';
      const result = sanitizeSvg(svg);
      expect(result).not.toContain('data-evil');
      expect(result).toContain('cx="12"');
    });

    test('handles deeply nested safe SVG', () => {
      const svg = '<svg viewBox="0 0 24 24"><g><g><g><circle cx="12" cy="12" r="10"/></g></g></g></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves the storybook sample active SVG', () => {
      const svg =
        '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" fill="#4F46E5"/><text x="16" y="21" text-anchor="middle" fill="white" font-size="16" font-family="sans-serif">S</text></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves the storybook sample inactive SVG', () => {
      const svg =
        '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" fill="#808080"/><text x="16" y="21" text-anchor="middle" fill="white" font-size="16" font-family="sans-serif">S</text></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves opacity attribute', () => {
      const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" opacity="0.5"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });

    test('preserves fill-rule and fill-opacity', () => {
      const svg = '<svg viewBox="0 0 24 24"><path d="M0 0" fill-rule="evenodd" fill-opacity="0.8"/></svg>';
      expect(sanitizeSvg(svg)).toBe(svg);
    });
  });
});
