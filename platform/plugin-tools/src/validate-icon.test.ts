import { describe, expect, test } from 'vitest';
import {
  DARK_BG_LUMINANCE,
  generateDarkIcon,
  generateInactiveIcon,
  MAX_ICON_SIZE,
  MIN_ICON_CONTRAST,
  MIN_INACTIVE_GRAY,
  namespaceSvgIds,
  validateIconSvg,
  validateInactiveIconColors,
} from './validate-icon.js';

/** Wrap SVG content in a valid SVG tag with a square viewBox */
const svgWrap = (inner: string, viewBox = '0 0 32 32'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;

// ---------------------------------------------------------------------------
// validateIconSvg
// ---------------------------------------------------------------------------

describe('validateIconSvg', () => {
  test('valid square SVG (viewBox="0 0 32 32") passes', () => {
    const svg = svgWrap('<rect width="32" height="32" fill="#000"/>');
    expect(validateIconSvg(svg, 'icon.svg')).toEqual({ valid: true });
  });

  test('valid square SVG with different dimensions (viewBox="0 0 100 100") passes', () => {
    const svg = svgWrap('<circle cx="50" cy="50" r="40"/>', '0 0 100 100');
    expect(validateIconSvg(svg, 'icon.svg')).toEqual({ valid: true });
  });

  test('missing viewBox attribute fails with "viewBox" in error', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.toLowerCase().includes('viewbox'))).toBe(true);
    }
  });

  test('non-square viewBox (viewBox="0 0 32 24") fails with "square" in error', () => {
    const svg = svgWrap('<rect/>', '0 0 32 24');
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.toLowerCase().includes('square'))).toBe(true);
    }
  });

  test('viewBox with non-zero min-x/min-y (viewBox="10 10 32 32") passes', () => {
    const svg = svgWrap('<rect/>', '10 10 32 32');
    expect(validateIconSvg(svg, 'icon.svg')).toEqual({ valid: true });
  });

  test('file exceeding 16KB fails with "size" in error', () => {
    const largeContent = `<rect/>${'x'.repeat(MAX_ICON_SIZE)}`;
    const svg = svgWrap(largeContent);
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.toLowerCase().includes('size'))).toBe(true);
    }
  });

  test('file exactly at 16KB passes', () => {
    // Build an SVG that is exactly MAX_ICON_SIZE bytes
    const prefix = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">';
    const suffix = '</svg>';
    const overhead = new TextEncoder().encode(prefix + suffix).byteLength;
    const padding = 'x'.repeat(MAX_ICON_SIZE - overhead);
    const svg = prefix + padding + suffix;
    expect(new TextEncoder().encode(svg).byteLength).toBe(MAX_ICON_SIZE);
    expect(validateIconSvg(svg, 'icon.svg')).toEqual({ valid: true });
  });

  test('contains <image> element fails with "image" in error', () => {
    const svg = svgWrap('<image href="data:image/png;base64,abc"/>');
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.toLowerCase().includes('image'))).toBe(true);
    }
  });

  test('contains <script> element fails with "script" in error', () => {
    const svg = svgWrap('<script>alert(1)</script>');
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.toLowerCase().includes('script'))).toBe(true);
    }
  });

  test('contains onclick attribute fails with "event handler" in error', () => {
    const svg = svgWrap('<rect onclick="alert(1)"/>');
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.toLowerCase().includes('event handler'))).toBe(true);
    }
  });

  test('contains onload attribute fails', () => {
    const svg = svgWrap('<rect onload="alert(1)"/>');
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
  });

  test('contains onerror attribute fails', () => {
    const svg = svgWrap('<rect onerror="alert(1)"/>');
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
  });

  test('multiple violations returns all errors, not just the first', () => {
    // Over-size + no viewBox + has <script> + has <image>
    const largeContent = 'x'.repeat(MAX_ICON_SIZE);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${largeContent}<script/><image/></svg>`;
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('self-closing <image/> is detected', () => {
    const svg = svgWrap('<image/>');
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.toLowerCase().includes('image'))).toBe(true);
    }
  });

  test('self-closing <script/> is detected', () => {
    const svg = svgWrap('<script/>');
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.toLowerCase().includes('script'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateInactiveIconColors
// ---------------------------------------------------------------------------

describe('validateInactiveIconColors', () => {
  test('fill="#333333" (R=G=B) passes', () => {
    const svg = svgWrap('<rect fill="#333333"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('fill="#333" (shorthand, R=G=B) passes', () => {
    const svg = svgWrap('<rect fill="#333"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('fill="#ff0000" (saturated red) fails', () => {
    const svg = svgWrap('<rect fill="#ff0000"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="#aabbcc" (R≠G≠B) fails', () => {
    const svg = svgWrap('<rect fill="#aabbcc"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('stroke="rgb(100, 100, 100)" (equal channels) passes', () => {
    const svg = svgWrap('<rect stroke="rgb(100, 100, 100)"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('stroke="rgb(255, 0, 0)" (unequal channels) fails', () => {
    const svg = svgWrap('<rect stroke="rgb(255, 0, 0)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="hsl(0, 0%, 50%)" (zero saturation) passes', () => {
    const svg = svgWrap('<rect fill="hsl(0, 0%, 50%)"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('fill="hsl(120, 50%, 50%)" (nonzero saturation) fails', () => {
    const svg = svgWrap('<rect fill="hsl(120, 50%, 50%)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('named color "gray" passes', () => {
    const svg = svgWrap('<rect fill="gray"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('named color "red" fails', () => {
    const svg = svgWrap('<rect fill="red"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="none" passes', () => {
    const svg = svgWrap('<rect fill="none"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('fill="currentColor" passes', () => {
    const svg = svgWrap('<rect fill="currentColor"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('fill="transparent" passes', () => {
    const svg = svgWrap('<rect fill="transparent"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('fill="inherit" passes', () => {
    const svg = svgWrap('<rect fill="inherit"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('no color attributes at all passes', () => {
    const svg = svgWrap('<rect width="10" height="10"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('colors in style="fill: #ff0000" inline styles fail', () => {
    const svg = svgWrap('<rect style="fill: #ff0000"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('colors in stop-color (SVG gradients) are validated', () => {
    const svg = svgWrap('<stop stop-color="#ff0000"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('achromatic named colors in list pass', () => {
    const svg = svgWrap('<rect fill="dimgray"/><rect fill="silver"/><rect fill="whitesmoke"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('flood-color attribute is validated', () => {
    const svg = svgWrap('<feFlood flood-color="#ff0000"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  // -- 8-digit and 4-digit hex (#RRGGBBAA, #RGBA) --

  test('fill="#FF0000FF" (#RRGGBBAA red with full opacity) fails', () => {
    const svg = svgWrap('<rect fill="#FF0000FF"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="#80808080" (#RRGGBBAA gray with alpha) passes', () => {
    const svg = svgWrap('<rect fill="#80808080"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('fill="#f00f" (#RGBA red with full opacity) fails', () => {
    const svg = svgWrap('<rect fill="#f00f"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="#888f" (#RGBA gray with alpha) passes', () => {
    const svg = svgWrap('<rect fill="#888f"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  // -- <style> block detection --

  test('<style> block with fill: red fails', () => {
    const svg = svgWrap('<style>circle { fill: red; }</style><circle/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('<style>'))).toBe(true);
    }
  });

  test('<style> block with stroke: #ff0000 fails', () => {
    const svg = svgWrap('<style>.cls { stroke: #ff0000; }</style><rect class="cls"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('<style> block with fill: rgb(255, 0, 0) fails', () => {
    const svg = svgWrap('<style>rect { fill: rgb(255, 0, 0); }</style><rect/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('<style> block with fill: #aabbcc (non-achromatic hex) fails', () => {
    const svg = svgWrap('<style>path { fill: #aabbcc; }</style><path/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('<style> block with fill: #aabbccdd (#RRGGBBAA non-achromatic) fails', () => {
    const svg = svgWrap('<style>path { fill: #aabbccdd; }</style><path/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('<style> block with fill: #abc (#RGB non-achromatic) fails', () => {
    const svg = svgWrap('<style>path { fill: #abc; }</style><path/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('<style> block with only achromatic colors passes', () => {
    const svg = svgWrap('<style>rect { fill: #333; stroke: gray; }</style><rect/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('<style> block with fill: black and stroke: white passes', () => {
    const svg = svgWrap('<style>.icon { fill: black; stroke: white; }</style><rect class="icon"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('<style> block with fill: none passes', () => {
    const svg = svgWrap('<style>rect { fill: none; }</style><rect/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('<style> block with both fill and stroke saturated reports both', () => {
    const svg = svgWrap('<style>rect { fill: red; stroke: blue; }</style><rect/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('multiple <style> blocks are all checked', () => {
    const svg = svgWrap('<style>rect { fill: gray; }</style><style>circle { fill: red; }</style><rect/><circle/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('<style> block with stop-color is validated', () => {
    const svg = svgWrap('<style>.gradient-stop { stop-color: #ff0000; }</style>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('<style> block with flood-color is validated', () => {
    const svg = svgWrap('<style>.flood { flood-color: orange; }</style>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  // -- Modern CSS Color Level 4 space-separated rgb() syntax --

  test('fill="rgb(255 0 0)" (modern syntax, saturated red) fails', () => {
    const svg = svgWrap('<rect fill="rgb(255 0 0)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="rgb(128 128 128)" (modern syntax, achromatic) passes', () => {
    const svg = svgWrap('<rect fill="rgb(128 128 128)"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('fill="rgb(255 0 0 / 0.5)" (modern syntax with alpha, saturated) fails', () => {
    const svg = svgWrap('<rect fill="rgb(255 0 0 / 0.5)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="rgba(255 0 0 / 0.5)" (modern rgba syntax, saturated) fails', () => {
    const svg = svgWrap('<rect fill="rgba(255 0 0 / 0.5)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="rgb(100% 0% 0%)" (modern percentage syntax, saturated) fails', () => {
    const svg = svgWrap('<rect fill="rgb(100% 0% 0%)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="rgb(100% 50% 0% / 0.5)" (modern percentage with alpha, saturated) fails', () => {
    const svg = svgWrap('<rect fill="rgb(100% 50% 0% / 0.5)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="rgb(50% 50% 50%)" (modern percentage, achromatic) passes', () => {
    const svg = svgWrap('<rect fill="rgb(50% 50% 50%)"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  // -- Modern CSS4 space-separated HSL syntax --

  test('fill="hsl(120 50% 50%)" (modern HSL, nonzero saturation) fails', () => {
    const svg = svgWrap('<rect fill="hsl(120 50% 50%)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="hsl(0 0% 50%)" (modern HSL, zero saturation) passes', () => {
    const svg = svgWrap('<rect fill="hsl(0 0% 50%)"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });

  test('fill="hsla(120 50% 50% / 0.5)" (modern HSLA, nonzero saturation) fails', () => {
    const svg = svgWrap('<rect fill="hsla(120 50% 50% / 0.5)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="hsl(120 50% 50% / 1)" (modern HSL with alpha, nonzero saturation) fails', () => {
    const svg = svgWrap('<rect fill="hsl(120 50% 50% / 1)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  // -- Legacy comma-separated percentage rgb() syntax --

  test('fill="rgb(100%, 0%, 0%)" (legacy comma percentage syntax, saturated red) fails', () => {
    const svg = svgWrap('<rect fill="rgb(100%, 0%, 0%)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="rgba(100%, 0%, 0%, 0.5)" (legacy comma percentage syntax with alpha, saturated) fails', () => {
    const svg = svgWrap('<rect fill="rgba(100%, 0%, 0%, 0.5)"/>');
    const result = validateInactiveIconColors(svg);
    expect(result.valid).toBe(false);
  });

  test('fill="rgb(50%, 50%, 50%)" (legacy comma percentage syntax, achromatic) passes', () => {
    const svg = svgWrap('<rect fill="rgb(50%, 50%, 50%)"/>');
    expect(validateInactiveIconColors(svg)).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// generateInactiveIcon
// ---------------------------------------------------------------------------

describe('generateInactiveIcon', () => {
  test('MIN_INACTIVE_GRAY is 153 (#999999)', () => {
    expect(MIN_INACTIVE_GRAY).toBe(153);
  });

  test('gray value above threshold is not clamped (rgb(100, 200, 50) → gray 168 → #a8a8a8)', () => {
    const svg = svgWrap('<rect fill="rgb(100, 200, 50)"/>');
    const result = generateInactiveIcon(svg);
    // 168 > 153, so no clamping
    expect(result).toContain('fill="#a8a8a8"');
  });

  test('HSL lightness above threshold is not clamped (hsl(0, 100%, 70%) → hsl(0, 0%, 70%))', () => {
    const svg = svgWrap('<rect fill="hsl(0, 100%, 70%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(0, 0%, 70%)"');
  });

  // -- Hex color conversion --

  test('fill="#ff0000" (pure red) → luminance 54 → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="#ff0000"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="#00ff00" (pure green) → luminance 182 → fill="#b6b6b6"', () => {
    const svg = svgWrap('<rect fill="#00ff00"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#b6b6b6"');
  });

  test('fill="#0000ff" (pure blue) → luminance 18 → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="#0000ff"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="#ffffff" (white) → luminance 255 → fill="#ffffff"', () => {
    const svg = svgWrap('<rect fill="#ffffff"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  test('fill="#000000" (black) → luminance 0 → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="#000000"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="#808080" (mid gray) → luminance 128 → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="#808080"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="#f00" (shorthand red) → same as #ff0000 → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="#f00"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="#4F46E5" (indigo) → luminance 83 → clamped to #999999', () => {
    // R=79, G=70, B=229: gray = round(0.2126*79 + 0.7152*70 + 0.0722*229)
    // = round(16.80 + 50.06 + 16.53) = round(83.39) = 83 → clamped to 153
    const svg = svgWrap('<rect fill="#4F46E5"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  // -- rgb()/rgba() conversion --

  test('fill="rgb(255, 0, 0)" → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="rgb(255, 0, 0)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="rgb(100, 200, 50)" → compute luminance → all channels equal', () => {
    // gray = round(0.2126*100 + 0.7152*200 + 0.0722*50)
    // = round(21.26 + 143.04 + 3.61) = round(167.91) = 168 → #a8a8a8
    const svg = svgWrap('<rect fill="rgb(100, 200, 50)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#a8a8a8"');
  });

  test('fill="rgba(255, 0, 0, 0.5)" → gray clamped, alpha preserved', () => {
    const svg = svgWrap('<rect fill="rgba(255, 0, 0, 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(153, 153, 153, 0.5)"');
  });

  test('fill="rgba(255, 0, 0)" (rgba without alpha) → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="rgba(255, 0, 0)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="rgba(255, 0, 0, 50%)" (percentage alpha) → gray clamped, percentage alpha preserved', () => {
    const svg = svgWrap('<rect fill="rgba(255, 0, 0, 50%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(153, 153, 153, 50%)"');
  });

  test('stroke="rgb(0, 128, 255)" → stroke attribute is clamped', () => {
    // gray = round(0.2126*0 + 0.7152*128 + 0.0722*255)
    // = round(0 + 91.55 + 18.41) = round(109.96) = 110 → clamped to 153
    const svg = svgWrap('<rect stroke="rgb(0, 128, 255)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('stroke="#999999"');
  });

  // -- hsl()/hsla() conversion --

  test('fill="hsl(0, 100%, 50%)" (pure red via HSL) → saturation 0%, lightness clamped to 60%', () => {
    const svg = svgWrap('<rect fill="hsl(0, 100%, 50%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(0, 0%, 60%)"');
  });

  test('fill="hsl(120, 80%, 40%)" → saturation 0%, lightness clamped to 60%', () => {
    const svg = svgWrap('<rect fill="hsl(120, 80%, 40%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(120, 0%, 60%)"');
  });

  test('fill="hsla(240, 100%, 50%, 0.8)" → lightness clamped to 60%, alpha preserved', () => {
    const svg = svgWrap('<rect fill="hsla(240, 100%, 50%, 0.8)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsla(240, 0%, 60%, 0.8)"');
  });

  test('fill="hsl(0, 0%, 50%)" (already gray, below threshold) → lightness clamped to 60%', () => {
    const svg = svgWrap('<rect fill="hsl(0, 0%, 50%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(0, 0%, 60%)"');
  });

  // -- Named color conversion --

  test('fill="red" → lookup #ff0000, luminance 54 → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="red"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="blue" → lookup #0000ff, luminance 18 → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="blue"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="white" → fill="#ffffff"', () => {
    const svg = svgWrap('<rect fill="white"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  test('fill="black" → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="black"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="gold" → lookup #ffd700, compute luminance → correct gray', () => {
    // gold=#ffd700: gray = round(0.2126*255 + 0.7152*215 + 0.0722*0)
    // = round(54.21 + 153.77 + 0) = round(207.98) = 208 → #d0d0d0
    const svg = svgWrap('<rect fill="gold"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#d0d0d0"');
  });

  // -- Passthrough values --

  test('fill="none" → unchanged', () => {
    const svg = svgWrap('<rect fill="none"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="none"');
  });

  test('fill="currentColor" → unchanged', () => {
    const svg = svgWrap('<rect fill="currentColor"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="currentColor"');
  });

  test('fill="transparent" → unchanged', () => {
    const svg = svgWrap('<rect fill="transparent"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="transparent"');
  });

  test('fill="inherit" → unchanged', () => {
    const svg = svgWrap('<rect fill="inherit"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="inherit"');
  });

  test('fill="url(#gradient)" → unchanged', () => {
    const svg = svgWrap('<rect fill="url(#gradient)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="url(#gradient)"');
  });

  // -- Multi-element SVG (integration) --

  test('rect fill="#ff0000" and circle fill="#00ff00" → different grays', () => {
    const svg = svgWrap('<rect fill="#ff0000"/><circle fill="#00ff00"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"'); // red (clamped)
    expect(result).toContain('fill="#b6b6b6"'); // green (above threshold)
  });

  test('both fill and stroke on same element → both converted independently', () => {
    const svg = svgWrap('<rect fill="#ff0000" stroke="#00ff00"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
    expect(result).toContain('stroke="#b6b6b6"');
  });

  test('colors in inline style attribute → both converted', () => {
    const svg = svgWrap('<rect style="fill: #ff0000; stroke: #00ff00"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #999999');
    expect(result).toContain('stroke: #b6b6b6');
  });

  test('stop-color in gradient stops → converted', () => {
    const svg = svgWrap('<linearGradient><stop stop-color="#ff0000"/></linearGradient>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('stop-color="#999999"');
  });

  test('flood-color attribute → converted', () => {
    const svg = svgWrap('<feFlood flood-color="#ff0000"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('flood-color="#999999"');
  });

  // -- Roundtrip validation --

  test('generateInactiveIcon output passes validateInactiveIconColors', () => {
    const svg = svgWrap(
      '<rect fill="#ff0000" stroke="#00ff00"/>' +
        '<circle fill="rgb(100, 200, 50)"/>' +
        '<path fill="blue" stroke="gold"/>',
    );
    const inactive = generateInactiveIcon(svg);
    expect(validateInactiveIconColors(inactive)).toEqual({ valid: true });
  });

  test('generateInactiveIcon output passes validateIconSvg (structure preserved)', () => {
    const svg = svgWrap('<rect fill="#ff0000" stroke="#00ff00"/>' + '<circle fill="hsl(120, 80%, 40%)"/>');
    const inactive = generateInactiveIcon(svg);
    expect(validateIconSvg(inactive, 'icon.svg')).toEqual({ valid: true });
  });

  // -- Edge cases --

  test('SVG with no color attributes → returned unchanged', () => {
    const svg = svgWrap('<rect width="10" height="10"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toBe(svg);
  });

  test('SVG with mixed color formats → all converted correctly', () => {
    const svg = svgWrap(
      '<rect fill="#ff0000"/>' +
        '<circle fill="rgb(0, 255, 0)"/>' +
        '<path stroke="blue"/>' +
        '<stop stop-color="hsl(0, 100%, 50%)"/>',
    );
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"'); // hex red (clamped)
    expect(result).toContain('fill="#b6b6b6"'); // rgb green (luminance 182 → above threshold)
    expect(result).toContain('stroke="#999999"'); // named blue (clamped)
    expect(result).toContain('stop-color="hsl(0, 0%, 60%)"'); // hsl red (lightness clamped)
  });

  test('color values with extra whitespace handled correctly', () => {
    const svg = svgWrap('<rect fill=" #ff0000 "/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('empty SVG (just <svg></svg> with viewBox) → returned unchanged', () => {
    const svg = svgWrap('');
    const result = generateInactiveIcon(svg);
    expect(result).toBe(svg);
  });

  // -- Additional edge cases for coverage --

  test('fill="#000" (shorthand black) → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="#000"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="#fff" (shorthand white) → fill="#ffffff"', () => {
    const svg = svgWrap('<rect fill="#fff"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  test('multiple stop-colors in gradient → each clamped', () => {
    const svg = svgWrap(
      '<linearGradient>' + '<stop stop-color="#ff0000"/>' + '<stop stop-color="#0000ff"/>' + '</linearGradient>',
    );
    const result = generateInactiveIcon(svg);
    // Both red (54) and blue (18) are below threshold, so both clamp to #999999
    expect(result).toContain('stop-color="#999999"');
  });

  test('inline style with multiple color properties → all converted', () => {
    const svg = svgWrap('<rect style="fill: red; stroke: blue; stop-color: gold"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #999999'); // red (clamped)
    expect(result).toContain('stroke: #999999'); // blue (clamped)
    expect(result).toContain('stop-color: #d0d0d0'); // gold (above threshold)
  });

  // -- 8-digit and 4-digit hex (#RRGGBBAA, #RGBA) --

  test('fill="#FF0000FF" (#RRGGBBAA red with full opacity) → luminance 54 → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="#FF0000FF"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="#00FF00FF" (#RRGGBBAA green with full opacity) → luminance 182 → fill="#b6b6b6"', () => {
    const svg = svgWrap('<rect fill="#00FF00FF"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#b6b6b6"');
  });

  test('fill="#f00f" (#RGBA red with full opacity) → luminance 54 → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="#f00f"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="#ffff" (#RGBA white) → luminance 255 → fill="#ffffff"', () => {
    const svg = svgWrap('<rect fill="#ffff"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  // -- <style> block conversion --

  test('<style> block fill: red → clamped to #999999', () => {
    const svg = svgWrap('<style>circle { fill: red; }</style><circle/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #999999');
    expect(result).not.toContain('fill: red');
  });

  test('<style> block stroke: #ff0000 → clamped to #999999', () => {
    const svg = svgWrap('<style>.cls { stroke: #ff0000; }</style><rect class="cls"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('stroke: #999999');
  });

  test('<style> block fill: rgb(255, 0, 0) → clamped to #999999', () => {
    const svg = svgWrap('<style>rect { fill: rgb(255, 0, 0); }</style><rect/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #999999');
  });

  test('<style> block fill: hsl(0, 100%, 50%) → saturation 0%, lightness clamped to 60%', () => {
    const svg = svgWrap('<style>rect { fill: hsl(0, 100%, 50%); }</style><rect/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: hsl(0, 0%, 60%)');
  });

  test('<style> block with multiple color properties → all clamped', () => {
    const svg = svgWrap('<style>rect { fill: red; stroke: blue; }</style><rect/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #999999');
    expect(result).toContain('stroke: #999999');
  });

  test('<style> block with achromatic colors → clamped to minimum', () => {
    const svg = svgWrap('<style>rect { fill: #333333; stroke: gray; }</style><rect/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #999999'); // #333333 (gray=51) clamped
    expect(result).toContain('stroke: #999999'); // gray (gray=128) clamped
  });

  test('<style> block with fill: none → unchanged', () => {
    const svg = svgWrap('<style>rect { fill: none; }</style><rect/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: none');
  });

  test('<style> block stop-color → clamped', () => {
    const svg = svgWrap('<style>.stop { stop-color: #ff0000; }</style>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('stop-color: #999999');
  });

  test('<style> block flood-color → converted', () => {
    const svg = svgWrap('<style>.flood { flood-color: gold; }</style>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('flood-color: #d0d0d0');
  });

  test('generateInactiveIcon output with <style> blocks passes validateInactiveIconColors', () => {
    const css = 'rect { fill: red; stroke: blue; } circle { fill: gold; }';
    const svg = svgWrap(`<style>${css}</style><rect/><circle/>`);
    const inactive = generateInactiveIcon(svg);
    expect(validateInactiveIconColors(inactive)).toEqual({ valid: true });
  });

  test('mixed <style> blocks and attribute colors → all converted', () => {
    const svg = svgWrap('<style>.cls { fill: red; }</style>' + '<rect class="cls" stroke="#00ff00"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #999999');
    expect(result).toContain('stroke="#b6b6b6"');
  });

  // -- Modern CSS Color Level 4 space-separated rgb() syntax --

  test('fill="rgb(255 0 0)" (modern syntax) → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="rgb(255 0 0)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="rgb(0 255 0)" (modern syntax, green) → #b6b6b6', () => {
    const svg = svgWrap('<rect fill="rgb(0 255 0)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#b6b6b6"');
  });

  test('fill="rgb(255 0 0 / 0.5)" (modern syntax with alpha) → clamped rgba(153, 153, 153, 0.5)', () => {
    const svg = svgWrap('<rect fill="rgb(255 0 0 / 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(153, 153, 153, 0.5)"');
  });

  test('fill="rgba(255 0 0 / 0.5)" (modern rgba syntax) → clamped rgba(153, 153, 153, 0.5)', () => {
    const svg = svgWrap('<rect fill="rgba(255 0 0 / 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(153, 153, 153, 0.5)"');
  });

  test('fill="rgb(100% 0% 0%)" (modern percentage syntax) → clamped to #999999', () => {
    const svg = svgWrap('<rect fill="rgb(100% 0% 0%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="rgb(100% 50% 0% / 0.5)" (modern percentage with alpha) → clamped rgba(153, 153, 153, 0.5)', () => {
    // R=255, G=round(50*2.55)=127 (fp: 50*2.55=127.499...), B=0
    // gray = round(0.2126*255 + 0.7152*127 + 0.0722*0) = round(54.213 + 90.830 + 0) = round(145.043) = 145
    // 145 < 153 → clamped to 153
    const svg = svgWrap('<rect fill="rgb(100% 50% 0% / 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(153, 153, 153, 0.5)"');
  });

  test('generateInactiveIcon output with modern syntax passes validateInactiveIconColors', () => {
    const svg = svgWrap(
      '<rect fill="rgb(255 0 0)"/>' + '<circle fill="rgb(0 255 0 / 0.8)"/>' + '<path stroke="rgb(100% 0% 0%)"/>',
    );
    const inactive = generateInactiveIcon(svg);
    expect(validateInactiveIconColors(inactive)).toEqual({ valid: true });
  });

  // -- Legacy comma-separated percentage rgb() syntax --

  test('fill="rgb(100%, 0%, 0%)" (legacy comma percentage syntax) → clamped to #999999', () => {
    // R=round(100*2.55)=255, G=0, B=0 → gray=round(0.2126*255)=54 → clamped to 153
    const svg = svgWrap('<rect fill="rgb(100%, 0%, 0%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#999999"');
  });

  test('fill="rgba(100%, 0%, 0%, 0.5)" (legacy comma percentage syntax with alpha) → clamped rgba(153, 153, 153, 0.5)', () => {
    const svg = svgWrap('<rect fill="rgba(100%, 0%, 0%, 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(153, 153, 153, 0.5)"');
  });

  test('generateInactiveIcon output with legacy comma percentage syntax passes validateInactiveIconColors', () => {
    const svg = svgWrap('<rect fill="rgb(100%, 0%, 0%)"/>' + '<circle fill="rgba(0%, 100%, 0%, 0.8)"/>');
    const inactive = generateInactiveIcon(svg);
    expect(validateInactiveIconColors(inactive)).toEqual({ valid: true });
  });

  // -- Modern CSS4 space-separated HSL syntax --

  test('fill="hsl(120 50% 50%)" (modern HSL, chromatic) → saturation 0%, lightness clamped to 60%', () => {
    const svg = svgWrap('<rect fill="hsl(120 50% 50%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(120 0% 60%)"');
  });

  test('fill="hsl(0 0% 50%)" (modern HSL, already achromatic) → lightness clamped to 60%', () => {
    const svg = svgWrap('<rect fill="hsl(0 0% 50%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(0 0% 60%)"');
  });

  test('fill="hsla(120 50% 50% / 0.5)" (modern HSLA) → saturation 0%, lightness clamped, alpha preserved', () => {
    const svg = svgWrap('<rect fill="hsla(120 50% 50% / 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsla(120 0% 60% / 0.5)"');
  });

  test('fill="hsl(120 50% 50% / 1)" (modern HSL with alpha) → saturation 0%, lightness clamped to 60%', () => {
    const svg = svgWrap('<rect fill="hsl(120 50% 50% / 1)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(120 0% 60% / 1)"');
  });

  test('generateInactiveIcon output with modern HSL syntax passes validateInactiveIconColors', () => {
    const svg = svgWrap(
      '<rect fill="hsl(120 50% 50%)"/>' +
        '<circle fill="hsla(240 100% 40% / 0.8)"/>' +
        '<path stroke="hsl(0 0% 50%)"/>',
    );
    const inactive = generateInactiveIcon(svg);
    expect(validateInactiveIconColors(inactive)).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// generateDarkIcon
// ---------------------------------------------------------------------------

describe('generateDarkIcon', () => {
  // -- Exported constants sanity checks --

  test('DARK_BG_LUMINANCE is a positive number', () => {
    expect(DARK_BG_LUMINANCE).toBeGreaterThan(0);
    expect(DARK_BG_LUMINANCE).toBeLessThan(1);
  });

  test('MIN_ICON_CONTRAST is 3 (WCAG AA for UI components)', () => {
    expect(MIN_ICON_CONTRAST).toBe(3);
  });

  // -- Black / very dark colors should be inverted (invisible on #1c1c1c) --

  test('fill="black" → inverted to a light color (visible on dark bg)', () => {
    const svg = svgWrap('<rect fill="black"/>');
    const result = generateDarkIcon(svg);
    // black (L=0%) inverted → L=100% → white
    expect(result).toContain('fill="#ffffff"');
  });

  test('fill="#000000" → inverted to #ffffff', () => {
    const svg = svgWrap('<rect fill="#000000"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  test('fill="#000" (shorthand black) → inverted to a light color', () => {
    const svg = svgWrap('<rect fill="#000"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  test('fill="#333333" (very dark gray) → inverted to a light gray', () => {
    const svg = svgWrap('<rect fill="#333333"/>');
    const result = generateDarkIcon(svg);
    // #333333 has low contrast against #1c1c1c → lightness inverted
    // Should NOT still be #333333
    expect(result).not.toContain('fill="#333333"');
    // Result should be a lighter hex
    const match = result.match(/fill="(#[0-9a-f]{6})"/i);
    expect(match).not.toBeNull();
    const hex = match?.[1] ?? '';
    const r = parseInt(hex.slice(1, 3), 16);
    expect(r).toBeGreaterThan(128); // light color
  });

  // -- Colorful brand icons with sufficient contrast should be unchanged --

  test('fill="#E01E5A" (Slack pink) → unchanged (sufficient contrast)', () => {
    const svg = svgWrap('<rect fill="#E01E5A"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#E01E5A"');
  });

  test('fill="#36C5F0" (Slack cyan) → unchanged', () => {
    const svg = svgWrap('<rect fill="#36C5F0"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#36C5F0"');
  });

  test('fill="#2EB67D" (Slack green) → unchanged', () => {
    const svg = svgWrap('<rect fill="#2EB67D"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#2EB67D"');
  });

  test('fill="#ECB22E" (Slack gold) → unchanged', () => {
    const svg = svgWrap('<rect fill="#ECB22E"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#ECB22E"');
  });

  test('fill="#5865F2" (Discord blurple) → unchanged', () => {
    const svg = svgWrap('<rect fill="#5865F2"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#5865F2"');
  });

  // -- White and light colors should be unchanged --

  test('fill="#ffffff" (white) → unchanged (high contrast against dark bg)', () => {
    const svg = svgWrap('<rect fill="#ffffff"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  test('fill="white" → unchanged', () => {
    const svg = svgWrap('<rect fill="white"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="white"');
  });

  test('fill="#cccccc" (light gray) → unchanged', () => {
    const svg = svgWrap('<rect fill="#cccccc"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#cccccc"');
  });

  // -- Passthrough values should be unchanged --

  test('fill="none" → unchanged', () => {
    const svg = svgWrap('<rect fill="none"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="none"');
  });

  test('fill="currentColor" → unchanged', () => {
    const svg = svgWrap('<rect fill="currentColor"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="currentColor"');
  });

  test('fill="transparent" → unchanged', () => {
    const svg = svgWrap('<rect fill="transparent"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="transparent"');
  });

  test('fill="inherit" → unchanged', () => {
    const svg = svgWrap('<rect fill="inherit"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="inherit"');
  });

  test('fill="url(#gradient)" → unchanged', () => {
    const svg = svgWrap('<rect fill="url(#gradient)"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="url(#gradient)"');
  });

  // -- RGB function syntax --

  test('fill="rgb(0, 0, 0)" → inverted (black via rgb)', () => {
    const svg = svgWrap('<rect fill="rgb(0, 0, 0)"/>');
    const result = generateDarkIcon(svg);
    // Should become a light color, not remain rgb(0, 0, 0)
    expect(result).not.toContain('rgb(0, 0, 0)');
  });

  test('fill="rgb(255, 0, 0)" (pure red) → unchanged (sufficient contrast)', () => {
    // Pure red (#ff0000) has relative luminance ~0.2126 and contrast vs #1c1c1c (~0.0113) is
    // (0.2126 + 0.05) / (0.0113 + 0.05) ≈ 4.28 — above 3:1 threshold
    const svg = svgWrap('<rect fill="rgb(255, 0, 0)"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="rgb(255, 0, 0)"');
  });

  // -- HSL syntax --

  test('fill="hsl(0, 0%, 0%)" (black via HSL) → inverted', () => {
    const svg = svgWrap('<rect fill="hsl(0, 0%, 0%)"/>');
    const result = generateDarkIcon(svg);
    expect(result).not.toContain('hsl(0, 0%, 0%)');
  });

  // -- Named colors --

  test('fill="red" → unchanged (sufficient contrast)', () => {
    const svg = svgWrap('<rect fill="red"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="red"');
  });

  test('fill="navy" → inverted (too dark)', () => {
    // navy = #000080, very dark blue, low contrast against #1c1c1c
    const svg = svgWrap('<rect fill="navy"/>');
    const result = generateDarkIcon(svg);
    expect(result).not.toContain('fill="navy"');
  });

  // -- Stroke attribute --

  test('stroke="black" → inverted', () => {
    const svg = svgWrap('<rect stroke="black"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('stroke="#ffffff"');
  });

  test('stroke="#5865F2" → unchanged', () => {
    const svg = svgWrap('<rect stroke="#5865F2"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('stroke="#5865F2"');
  });

  // -- Inline styles --

  test('inline style fill: black → inverted', () => {
    const svg = svgWrap('<rect style="fill: black"/>');
    const result = generateDarkIcon(svg);
    expect(result).not.toContain('fill: black');
    expect(result).toContain('fill: #ffffff');
  });

  test('inline style fill: #E01E5A → unchanged', () => {
    const svg = svgWrap('<rect style="fill: #E01E5A"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill: #E01E5A');
  });

  test('inline style with multiple properties → each handled independently', () => {
    const svg = svgWrap('<rect style="fill: black; stroke: #5865F2"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill: #ffffff');
    expect(result).toContain('stroke: #5865F2');
  });

  // -- <style> blocks --

  test('<style> block fill: black → inverted', () => {
    const svg = svgWrap('<style>rect { fill: black; }</style><rect/>');
    const result = generateDarkIcon(svg);
    expect(result).not.toContain('fill: black');
  });

  test('<style> block fill: #5865F2 → unchanged', () => {
    const svg = svgWrap('<style>rect { fill: #5865F2; }</style><rect/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill: #5865F2');
  });

  test('<style> block with mixed colors → dark inverted, light unchanged', () => {
    const svg = svgWrap('<style>rect { fill: black; stroke: #ECB22E; }</style><rect/>');
    const result = generateDarkIcon(svg);
    expect(result).not.toContain('fill: black');
    expect(result).toContain('stroke: #ECB22E');
  });

  // -- stop-color and flood-color --

  test('stop-color="black" → inverted', () => {
    const svg = svgWrap('<stop stop-color="black"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('stop-color="#ffffff"');
  });

  test('flood-color="#000000" → inverted', () => {
    const svg = svgWrap('<feFlood flood-color="#000000"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('flood-color="#ffffff"');
  });

  // -- Multi-element integration (GitHub-like icon) --

  test('GitHub-like icon: single black fill → becomes white', () => {
    const svg = svgWrap('<path d="M41 69C28 67 19 58..." fill="black"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#ffffff"');
    expect(result).not.toContain('fill="black"');
  });

  // -- Slack-like multi-color icon: all colors preserved --

  test('Slack-like icon: all brand colors unchanged', () => {
    const svg = svgWrap(
      '<path fill="#E01E5A"/>' + '<path fill="#36C5F0"/>' + '<path fill="#2EB67D"/>' + '<path fill="#ECB22E"/>',
    );
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#E01E5A"');
    expect(result).toContain('fill="#36C5F0"');
    expect(result).toContain('fill="#2EB67D"');
    expect(result).toContain('fill="#ECB22E"');
  });

  // -- SVG with no color attributes → returned unchanged --

  test('SVG with no color attributes → unchanged', () => {
    const svg = svgWrap('<rect width="10" height="10"/>');
    const result = generateDarkIcon(svg);
    expect(result).toBe(svg);
  });

  test('empty SVG → unchanged', () => {
    const svg = svgWrap('');
    const result = generateDarkIcon(svg);
    expect(result).toBe(svg);
  });

  // -- Structure preservation --

  test('generateDarkIcon output passes validateIconSvg (structure preserved)', () => {
    const svg = svgWrap('<rect fill="black" stroke="#333"/><circle fill="#5865F2"/>');
    const dark = generateDarkIcon(svg);
    expect(validateIconSvg(dark, 'icon-dark.svg')).toEqual({ valid: true });
  });

  // -- Grayscale of dark icon produces valid inactive icon --

  test('generateInactiveIcon(generateDarkIcon(...)) passes color validation', () => {
    const svg = svgWrap('<rect fill="black"/><circle fill="#5865F2"/><path stroke="#E01E5A"/>');
    const dark = generateDarkIcon(svg);
    const darkInactive = generateInactiveIcon(dark);
    expect(validateInactiveIconColors(darkInactive)).toEqual({ valid: true });
  });

  // -- Mixed attribute and style colors --

  test('mixed attribute fill="black" and style fill: #ECB22E → correct handling', () => {
    const svg = svgWrap('<rect fill="black"/><circle style="fill: #ECB22E"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="#ffffff"');
    expect(result).toContain('fill: #ECB22E');
  });

  // -- Dark blue / dark green (edge cases near contrast threshold) --

  test('fill="#0000ff" (pure blue, L=50%) → lightness boosted until visible', () => {
    // Pure blue at HSL(240, 100%, 50%): lightness inversion gives 50% again (same color).
    // The algorithm detects insufficient contrast and boosts lightness further.
    const svg = svgWrap('<rect fill="#0000ff"/>');
    const result = generateDarkIcon(svg);
    expect(result).not.toContain('fill="#0000ff"');
    // Result should be a lighter blue (hue preserved, lightness increased)
    const match = result.match(/fill="(#[0-9a-f]{6})"/i);
    expect(match).not.toBeNull();
    const hex = match?.[1] ?? '';
    const b = parseInt(hex.slice(5, 7), 16);
    expect(b).toBe(255); // blue channel should stay maxed
  });

  test('fill="darkgreen" → inverted (too dark against #1c1c1c)', () => {
    // darkgreen = #006400, very low luminance
    const svg = svgWrap('<rect fill="darkgreen"/>');
    const result = generateDarkIcon(svg);
    expect(result).not.toContain('fill="darkgreen"');
  });

  test('fill="gold" → unchanged (bright enough)', () => {
    // gold = #ffd700, high luminance
    const svg = svgWrap('<rect fill="gold"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="gold"');
  });

  // -- Lightness inversion preserves hue for chromatic colors --

  test('dark red (#800000, maroon) → inverted to a light red, not gray', () => {
    const svg = svgWrap('<rect fill="#800000"/>');
    const result = generateDarkIcon(svg);
    const match = result.match(/fill="(#[0-9a-f]{6})"/i);
    expect(match).not.toBeNull();
    const hex = match?.[1] ?? '';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Red channel should be dominant (hue preserved)
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    // And it should be light enough to be visible
    expect(r).toBeGreaterThan(128);
  });

  // -- Modern CSS4 space-separated syntax --

  test('fill="rgb(0 0 0)" (modern syntax black) → inverted', () => {
    const svg = svgWrap('<rect fill="rgb(0 0 0)"/>');
    const result = generateDarkIcon(svg);
    expect(result).not.toContain('rgb(0 0 0)');
  });

  test('fill="rgb(255 0 0)" (modern syntax red) → unchanged (sufficient contrast)', () => {
    const svg = svgWrap('<rect fill="rgb(255 0 0)"/>');
    const result = generateDarkIcon(svg);
    expect(result).toContain('fill="rgb(255 0 0)"');
  });
});

// ---------------------------------------------------------------------------
// namespaceSvgIds
// ---------------------------------------------------------------------------

describe('namespaceSvgIds', () => {
  test('rewrites id and url(#id) references', () => {
    const svg = svgWrap('<defs><linearGradient id="grad1"><stop/></linearGradient></defs><rect fill="url(#grad1)"/>');
    const result = namespaceSvgIds(svg, 'myplugin');
    expect(result).toContain('id="myplugin-grad1"');
    expect(result).toContain('url(#myplugin-grad1)');
    expect(result).not.toContain('id="grad1"');
    expect(result).not.toContain('url(#grad1)');
  });

  test('rewrites xlink:href="#id" references', () => {
    const svg = svgWrap('<linearGradient id="a"/><linearGradient xlink:href="#a"/>');
    const result = namespaceSvgIds(svg, 'test');
    expect(result).toContain('id="test-a"');
    expect(result).toContain('xlink:href="#test-a"');
    expect(result).not.toContain('xlink:href="#a"');
  });

  test('rewrites href="#id" references', () => {
    const svg = svgWrap('<linearGradient id="a"/><use href="#a"/>');
    const result = namespaceSvgIds(svg, 'test');
    expect(result).toContain('id="test-a"');
    expect(result).toContain('href="#test-a"');
    expect(result).not.toContain('href="#a"');
  });

  test('rewrites multiple IDs independently', () => {
    const svg = svgWrap(
      '<defs><linearGradient id="a"><stop/></linearGradient><linearGradient id="b"><stop/></linearGradient></defs><path fill="url(#a)"/><path fill="url(#b)"/>',
    );
    const result = namespaceSvgIds(svg, 'multi');
    expect(result).toContain('id="multi-a"');
    expect(result).toContain('id="multi-b"');
    expect(result).toContain('url(#multi-a)');
    expect(result).toContain('url(#multi-b)');
    expect(result).not.toContain('id="a"');
    expect(result).not.toContain('id="b"');
  });

  test('SVG with no IDs returns unchanged', () => {
    const svg = svgWrap('<rect fill="#ff0000"/>');
    const result = namespaceSvgIds(svg, 'prefix');
    expect(result).toBe(svg);
  });

  test('IDs with regex special characters are handled correctly', () => {
    const svg = svgWrap('<defs><linearGradient id="a.b+c"><stop/></linearGradient></defs><rect fill="url(#a.b+c)"/>');
    const result = namespaceSvgIds(svg, 'p');
    expect(result).toContain('id="p-a.b+c"');
    expect(result).toContain('url(#p-a.b+c)');
    expect(result).not.toContain('id="a.b+c"');
  });

  test('passthrough values (fill="none", fill="currentColor") are not affected', () => {
    const svg = svgWrap(
      '<defs><linearGradient id="g"><stop/></linearGradient></defs><rect fill="none" stroke="currentColor"/><circle fill="url(#g)"/>',
    );
    const result = namespaceSvgIds(svg, 'ns');
    expect(result).toContain('fill="none"');
    expect(result).toContain('stroke="currentColor"');
    expect(result).toContain('id="ns-g"');
    expect(result).toContain('url(#ns-g)');
  });

  test('real-world Jira icon scenario (linearGradient with id="a" and id="b", url(#a), url(#b))', () => {
    const svg = svgWrap(
      '<defs><linearGradient id="a"><stop stop-color="#0052CC"/><stop offset="1" stop-color="#2684FF"/></linearGradient><linearGradient id="b"><stop stop-color="#0052CC"/><stop offset="1" stop-color="#2684FF"/></linearGradient></defs><path fill="#2684FF" d="M0 0h32"/><path fill="url(#a)" d="M16 0"/><path fill="url(#b)" d="M16 16"/>',
    );
    const result = namespaceSvgIds(svg, 'jira');
    expect(result).toContain('id="jira-a"');
    expect(result).toContain('id="jira-b"');
    expect(result).toContain('url(#jira-a)');
    expect(result).toContain('url(#jira-b)');
    expect(result).not.toContain('id="a"');
    expect(result).not.toContain('id="b"');
    expect(result).toContain('fill="#2684FF"');
  });

  test('real-world Confluence icon scenario (xlink:href="#a" in gradient)', () => {
    const svg = svgWrap(
      '<defs><linearGradient id="a"><stop stop-color="#0052CC"/></linearGradient><linearGradient xlink:href="#a" id="b"/></defs><path fill="url(#a)"/><path fill="url(#b)"/>',
    );
    const result = namespaceSvgIds(svg, 'confluence');
    expect(result).toContain('id="confluence-a"');
    expect(result).toContain('id="confluence-b"');
    expect(result).toContain('xlink:href="#confluence-a"');
    expect(result).toContain('url(#confluence-a)');
    expect(result).toContain('url(#confluence-b)');
  });

  test('clipPath with id and url(#id) reference', () => {
    const svg = svgWrap(
      '<defs><clipPath id="clip0"><rect width="32" height="32"/></clipPath></defs><g clip-path="url(#clip0)"><circle cx="16" cy="16" r="12" fill="#ff0000"/></g>',
    );
    const result = namespaceSvgIds(svg, 'discord');
    expect(result).toContain('id="discord-clip0"');
    expect(result).toContain('url(#discord-clip0)');
    expect(result).not.toContain('id="clip0"');
  });

  test('two SVGs with same IDs namespaced differently produce non-colliding IDs', () => {
    const svg1 = svgWrap('<defs><linearGradient id="a"><stop/></linearGradient></defs><rect fill="url(#a)"/>');
    const svg2 = svgWrap('<defs><linearGradient id="a"><stop/></linearGradient></defs><rect fill="url(#a)"/>');
    const result1 = namespaceSvgIds(svg1, 'jira');
    const result2 = namespaceSvgIds(svg2, 'confluence');
    expect(result1).toContain('id="jira-a"');
    expect(result2).toContain('id="confluence-a"');
    expect(result1).not.toContain('id="confluence-a"');
    expect(result2).not.toContain('id="jira-a"');
  });

  test('already-namespaced SVG gets double-prefixed (no idempotence detection)', () => {
    const svg = svgWrap('<defs><linearGradient id="p-a"><stop/></linearGradient></defs><rect fill="url(#p-a)"/>');
    const result = namespaceSvgIds(svg, 'p');
    expect(result).toContain('id="p-p-a"');
    expect(result).toContain('url(#p-p-a)');
  });
});
