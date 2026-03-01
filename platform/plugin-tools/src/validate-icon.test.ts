import { generateInactiveIcon, MAX_ICON_SIZE, validateIconSvg, validateInactiveIconColors } from './validate-icon.js';
import { describe, expect, test } from 'vitest';

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

  test('file exceeding 8KB fails with "size" in error', () => {
    const largeContent = '<rect/>' + 'x'.repeat(MAX_ICON_SIZE);
    const svg = svgWrap(largeContent);
    const result = validateIconSvg(svg, 'icon.svg');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.toLowerCase().includes('size'))).toBe(true);
    }
  });

  test('file exactly at 8KB passes', () => {
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
  // -- Hex color conversion --

  test('fill="#ff0000" (pure red) → luminance 54 → fill="#363636"', () => {
    const svg = svgWrap('<rect fill="#ff0000"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
  });

  test('fill="#00ff00" (pure green) → luminance 182 → fill="#b6b6b6"', () => {
    const svg = svgWrap('<rect fill="#00ff00"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#b6b6b6"');
  });

  test('fill="#0000ff" (pure blue) → luminance 18 → fill="#121212"', () => {
    const svg = svgWrap('<rect fill="#0000ff"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#121212"');
  });

  test('fill="#ffffff" (white) → luminance 255 → fill="#ffffff"', () => {
    const svg = svgWrap('<rect fill="#ffffff"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  test('fill="#000000" (black) → luminance 0 → fill="#000000"', () => {
    const svg = svgWrap('<rect fill="#000000"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#000000"');
  });

  test('fill="#808080" (mid gray) → luminance 128 → fill="#808080"', () => {
    const svg = svgWrap('<rect fill="#808080"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#808080"');
  });

  test('fill="#f00" (shorthand red) → same as #ff0000 → fill="#363636"', () => {
    const svg = svgWrap('<rect fill="#f00"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
  });

  test('fill="#4F46E5" (indigo) → correct luminance gray', () => {
    // R=79, G=70, B=229: gray = round(0.2126*79 + 0.7152*70 + 0.0722*229)
    // = round(16.80 + 50.06 + 16.53) = round(83.39) = 83 → #535353
    const svg = svgWrap('<rect fill="#4F46E5"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#535353"');
  });

  // -- rgb()/rgba() conversion --

  test('fill="rgb(255, 0, 0)" → #363636', () => {
    const svg = svgWrap('<rect fill="rgb(255, 0, 0)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
  });

  test('fill="rgb(100, 200, 50)" → compute luminance → all channels equal', () => {
    // gray = round(0.2126*100 + 0.7152*200 + 0.0722*50)
    // = round(21.26 + 143.04 + 3.61) = round(167.91) = 168 → #a8a8a8
    const svg = svgWrap('<rect fill="rgb(100, 200, 50)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#a8a8a8"');
  });

  test('fill="rgba(255, 0, 0, 0.5)" → gray conversion preserves alpha', () => {
    const svg = svgWrap('<rect fill="rgba(255, 0, 0, 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(54, 54, 54, 0.5)"');
  });

  test('stroke="rgb(0, 128, 255)" → stroke attribute is converted', () => {
    // gray = round(0.2126*0 + 0.7152*128 + 0.0722*255)
    // = round(0 + 91.55 + 18.41) = round(109.96) = 110 → #6e6e6e
    const svg = svgWrap('<rect stroke="rgb(0, 128, 255)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('stroke="#6e6e6e"');
  });

  // -- hsl()/hsla() conversion --

  test('fill="hsl(0, 100%, 50%)" (pure red via HSL) → saturation set to 0%', () => {
    const svg = svgWrap('<rect fill="hsl(0, 100%, 50%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(0, 0%, 50%)"');
  });

  test('fill="hsl(120, 80%, 40%)" → hsl with saturation 0%', () => {
    const svg = svgWrap('<rect fill="hsl(120, 80%, 40%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(120, 0%, 40%)"');
  });

  test('fill="hsla(240, 100%, 50%, 0.8)" → alpha preserved', () => {
    const svg = svgWrap('<rect fill="hsla(240, 100%, 50%, 0.8)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsla(240, 0%, 50%, 0.8)"');
  });

  test('fill="hsl(0, 0%, 50%)" (already gray) → unchanged', () => {
    const svg = svgWrap('<rect fill="hsl(0, 0%, 50%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(0, 0%, 50%)"');
  });

  // -- Named color conversion --

  test('fill="red" → lookup #ff0000, compute luminance → fill="#363636"', () => {
    const svg = svgWrap('<rect fill="red"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
  });

  test('fill="blue" → lookup #0000ff → fill="#121212"', () => {
    const svg = svgWrap('<rect fill="blue"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#121212"');
  });

  test('fill="white" → fill="#ffffff"', () => {
    const svg = svgWrap('<rect fill="white"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  test('fill="black" → fill="#000000"', () => {
    const svg = svgWrap('<rect fill="black"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#000000"');
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
    expect(result).toContain('fill="#363636"'); // red
    expect(result).toContain('fill="#b6b6b6"'); // green
  });

  test('both fill and stroke on same element → both converted independently', () => {
    const svg = svgWrap('<rect fill="#ff0000" stroke="#00ff00"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
    expect(result).toContain('stroke="#b6b6b6"');
  });

  test('colors in inline style attribute → both converted', () => {
    const svg = svgWrap('<rect style="fill: #ff0000; stroke: #00ff00"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #363636');
    expect(result).toContain('stroke: #b6b6b6');
  });

  test('stop-color in gradient stops → converted', () => {
    const svg = svgWrap('<linearGradient><stop stop-color="#ff0000"/></linearGradient>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('stop-color="#363636"');
  });

  test('flood-color attribute → converted', () => {
    const svg = svgWrap('<feFlood flood-color="#ff0000"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('flood-color="#363636"');
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
    expect(result).toContain('fill="#363636"'); // hex red
    expect(result).toContain('fill="#b6b6b6"'); // rgb green (luminance 182 → #b6b6b6)
    expect(result).toContain('stroke="#121212"'); // named blue
    expect(result).toContain('stop-color="hsl(0, 0%, 50%)"'); // hsl red
  });

  test('color values with extra whitespace handled correctly', () => {
    const svg = svgWrap('<rect fill=" #ff0000 "/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
  });

  test('empty SVG (just <svg></svg> with viewBox) → returned unchanged', () => {
    const svg = svgWrap('');
    const result = generateInactiveIcon(svg);
    expect(result).toBe(svg);
  });

  // -- Additional edge cases for coverage --

  test('fill="#000" (shorthand black) → fill="#000000"', () => {
    const svg = svgWrap('<rect fill="#000"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#000000"');
  });

  test('fill="#fff" (shorthand white) → fill="#ffffff"', () => {
    const svg = svgWrap('<rect fill="#fff"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  test('multiple stop-colors in gradient → each converted', () => {
    const svg = svgWrap(
      '<linearGradient>' + '<stop stop-color="#ff0000"/>' + '<stop stop-color="#0000ff"/>' + '</linearGradient>',
    );
    const result = generateInactiveIcon(svg);
    expect(result).toContain('stop-color="#363636"'); // red
    expect(result).toContain('stop-color="#121212"'); // blue
  });

  test('inline style with multiple color properties → all converted', () => {
    const svg = svgWrap('<rect style="fill: red; stroke: blue; stop-color: gold"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #363636');
    expect(result).toContain('stroke: #121212');
    expect(result).toContain('stop-color: #d0d0d0');
  });

  // -- 8-digit and 4-digit hex (#RRGGBBAA, #RGBA) --

  test('fill="#FF0000FF" (#RRGGBBAA red with full opacity) → luminance 54 → fill="#363636"', () => {
    const svg = svgWrap('<rect fill="#FF0000FF"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
  });

  test('fill="#00FF00FF" (#RRGGBBAA green with full opacity) → luminance 182 → fill="#b6b6b6"', () => {
    const svg = svgWrap('<rect fill="#00FF00FF"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#b6b6b6"');
  });

  test('fill="#f00f" (#RGBA red with full opacity) → luminance 54 → fill="#363636"', () => {
    const svg = svgWrap('<rect fill="#f00f"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
  });

  test('fill="#ffff" (#RGBA white) → luminance 255 → fill="#ffffff"', () => {
    const svg = svgWrap('<rect fill="#ffff"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#ffffff"');
  });

  // -- <style> block conversion --

  test('<style> block fill: red → converted to grayscale hex', () => {
    const svg = svgWrap('<style>circle { fill: red; }</style><circle/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #363636');
    expect(result).not.toContain('fill: red');
  });

  test('<style> block stroke: #ff0000 → converted to grayscale', () => {
    const svg = svgWrap('<style>.cls { stroke: #ff0000; }</style><rect class="cls"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('stroke: #363636');
  });

  test('<style> block fill: rgb(255, 0, 0) → converted to grayscale', () => {
    const svg = svgWrap('<style>rect { fill: rgb(255, 0, 0); }</style><rect/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #363636');
  });

  test('<style> block fill: hsl(0, 100%, 50%) → saturation set to 0%', () => {
    const svg = svgWrap('<style>rect { fill: hsl(0, 100%, 50%); }</style><rect/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: hsl(0, 0%, 50%)');
  });

  test('<style> block with multiple color properties → all converted', () => {
    const svg = svgWrap('<style>rect { fill: red; stroke: blue; }</style><rect/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #363636');
    expect(result).toContain('stroke: #121212');
  });

  test('<style> block with achromatic colors → unchanged values', () => {
    const svg = svgWrap('<style>rect { fill: #333333; stroke: gray; }</style><rect/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: #333333');
    expect(result).toContain('stroke: #808080');
  });

  test('<style> block with fill: none → unchanged', () => {
    const svg = svgWrap('<style>rect { fill: none; }</style><rect/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill: none');
  });

  test('<style> block stop-color → converted', () => {
    const svg = svgWrap('<style>.stop { stop-color: #ff0000; }</style>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('stop-color: #363636');
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
    expect(result).toContain('fill: #363636');
    expect(result).toContain('stroke="#b6b6b6"');
  });

  // -- Modern CSS Color Level 4 space-separated rgb() syntax --

  test('fill="rgb(255 0 0)" (modern syntax) → #363636', () => {
    const svg = svgWrap('<rect fill="rgb(255 0 0)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
  });

  test('fill="rgb(0 255 0)" (modern syntax, green) → #b6b6b6', () => {
    const svg = svgWrap('<rect fill="rgb(0 255 0)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#b6b6b6"');
  });

  test('fill="rgb(255 0 0 / 0.5)" (modern syntax with alpha) → rgba(54, 54, 54, 0.5)', () => {
    const svg = svgWrap('<rect fill="rgb(255 0 0 / 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(54, 54, 54, 0.5)"');
  });

  test('fill="rgba(255 0 0 / 0.5)" (modern rgba syntax) → rgba(54, 54, 54, 0.5)', () => {
    const svg = svgWrap('<rect fill="rgba(255 0 0 / 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(54, 54, 54, 0.5)"');
  });

  test('fill="rgb(100% 0% 0%)" (modern percentage syntax) → #363636', () => {
    const svg = svgWrap('<rect fill="rgb(100% 0% 0%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
  });

  test('fill="rgb(100% 50% 0% / 0.5)" (modern percentage with alpha) → rgba(145, 145, 145, 0.5)', () => {
    // R=255, G=round(50*2.55)=127 (fp: 50*2.55=127.499...), B=0
    // gray = round(0.2126*255 + 0.7152*127 + 0.0722*0) = round(54.213 + 90.830 + 0) = round(145.043) = 145
    const svg = svgWrap('<rect fill="rgb(100% 50% 0% / 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(145, 145, 145, 0.5)"');
  });

  test('generateInactiveIcon output with modern syntax passes validateInactiveIconColors', () => {
    const svg = svgWrap(
      '<rect fill="rgb(255 0 0)"/>' + '<circle fill="rgb(0 255 0 / 0.8)"/>' + '<path stroke="rgb(100% 0% 0%)"/>',
    );
    const inactive = generateInactiveIcon(svg);
    expect(validateInactiveIconColors(inactive)).toEqual({ valid: true });
  });

  // -- Legacy comma-separated percentage rgb() syntax --

  test('fill="rgb(100%, 0%, 0%)" (legacy comma percentage syntax) → #363636', () => {
    // R=round(100*2.55)=255, G=0, B=0 → gray=round(0.2126*255)=54 → #363636
    const svg = svgWrap('<rect fill="rgb(100%, 0%, 0%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="#363636"');
  });

  test('fill="rgba(100%, 0%, 0%, 0.5)" (legacy comma percentage syntax with alpha) → rgba(54, 54, 54, 0.5)', () => {
    const svg = svgWrap('<rect fill="rgba(100%, 0%, 0%, 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="rgba(54, 54, 54, 0.5)"');
  });

  test('generateInactiveIcon output with legacy comma percentage syntax passes validateInactiveIconColors', () => {
    const svg = svgWrap('<rect fill="rgb(100%, 0%, 0%)"/>' + '<circle fill="rgba(0%, 100%, 0%, 0.8)"/>');
    const inactive = generateInactiveIcon(svg);
    expect(validateInactiveIconColors(inactive)).toEqual({ valid: true });
  });

  // -- Modern CSS4 space-separated HSL syntax --

  test('fill="hsl(120 50% 50%)" (modern HSL, chromatic) → saturation set to 0%', () => {
    const svg = svgWrap('<rect fill="hsl(120 50% 50%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(120 0% 50%)"');
  });

  test('fill="hsl(0 0% 50%)" (modern HSL, already achromatic) → unchanged saturation', () => {
    const svg = svgWrap('<rect fill="hsl(0 0% 50%)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(0 0% 50%)"');
  });

  test('fill="hsla(120 50% 50% / 0.5)" (modern HSLA) → saturation set to 0%, alpha preserved', () => {
    const svg = svgWrap('<rect fill="hsla(120 50% 50% / 0.5)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsla(120 0% 50% / 0.5)"');
  });

  test('fill="hsl(120 50% 50% / 1)" (modern HSL with alpha) → saturation set to 0%', () => {
    const svg = svgWrap('<rect fill="hsl(120 50% 50% / 1)"/>');
    const result = generateInactiveIcon(svg);
    expect(result).toContain('fill="hsl(120 0% 50% / 1)"');
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
