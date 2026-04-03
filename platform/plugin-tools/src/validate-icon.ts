/**
 * SVG icon validation and auto-grayscale generation for plugin icons.
 *
 * Three exports:
 * - validateIconSvg — structural validation (size, viewBox, forbidden elements)
 * - validateInactiveIconColors — ensures only achromatic colors are present
 * - generateInactiveIcon — converts all color values to luminance-equivalent grays
 */

const MAX_ICON_SIZE = 16 * 1024; // 16 KB

// ---------------------------------------------------------------------------
// Named color lookup table (CSS2.1 + common extended names)
// ---------------------------------------------------------------------------

const NAMED_COLORS: Record<string, [number, number, number]> = {
  aqua: [0, 255, 255],
  black: [0, 0, 0],
  blue: [0, 0, 255],
  fuchsia: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  maroon: [128, 0, 0],
  navy: [0, 0, 128],
  olive: [128, 128, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  red: [255, 0, 0],
  silver: [192, 192, 192],
  teal: [0, 128, 128],
  white: [255, 255, 255],
  yellow: [255, 255, 0],
  gold: [255, 215, 0],
  indigo: [75, 0, 130],
  coral: [255, 127, 80],
  crimson: [220, 20, 60],
  tomato: [255, 99, 71],
  salmon: [250, 128, 114],
  orchid: [218, 112, 214],
  plum: [221, 160, 221],
  chocolate: [210, 105, 30],
  tan: [210, 180, 140],
  peru: [205, 133, 63],
  sienna: [160, 82, 45],
  firebrick: [178, 34, 34],
  darkred: [139, 0, 0],
  darkgreen: [0, 100, 0],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkmagenta: [139, 0, 139],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dodgerblue: [30, 144, 255],
  hotpink: [255, 105, 180],
  lawngreen: [124, 252, 0],
  limegreen: [50, 205, 50],
  mediumblue: [0, 0, 205],
  mediumorchid: [186, 85, 211],
  mediumpurple: [147, 111, 219],
  mediumseagreen: [60, 179, 113],
  mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154],
  mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112],
  orangered: [255, 69, 0],
  palegreen: [152, 251, 152],
  palevioletred: [219, 112, 147],
  royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19],
  seagreen: [46, 139, 87],
  skyblue: [135, 206, 235],
  slateblue: [106, 90, 205],
  springgreen: [0, 255, 127],
  steelblue: [70, 130, 180],
  turquoise: [64, 224, 208],
  violet: [238, 130, 238],
  wheat: [245, 222, 179],
  yellowgreen: [154, 205, 50],
  // Achromatic named colors
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  gainsboro: [220, 220, 220],
  whitesmoke: [245, 245, 245],
};

// ---------------------------------------------------------------------------
// Achromatic color names (allowed in inactive icons)
// ---------------------------------------------------------------------------

const ACHROMATIC_NAMES = new Set([
  'black',
  'white',
  'gray',
  'grey',
  'silver',
  'dimgray',
  'dimgrey',
  'darkgray',
  'darkgrey',
  'lightgray',
  'lightgrey',
  'gainsboro',
  'whitesmoke',
]);

// Values that are not actual colors and should be passed through unchanged
const PASSTHROUGH_VALUES = new Set(['none', 'currentcolor', 'transparent', 'inherit', 'unset', 'initial']);

// Color-carrying attributes in SVG
const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color'];

// Event handler attributes to reject
const EVENT_HANDLER_RE =
  /\bon(?:abort|activate|afterprint|beforeprint|beforeunload|blur|cancel|canplay|canplaythrough|change|click|close|contextmenu|copy|cuechange|cut|dblclick|drag|dragend|dragenter|dragleave|dragover|dragstart|drop|durationchange|emptied|ended|error|focus|focusin|focusout|formdata|fullscreenchange|fullscreenerror|hashchange|input|invalid|keydown|keypress|keyup|load|loadeddata|loadedmetadata|loadstart|message|messageerror|mousedown|mouseenter|mouseleave|mousemove|mouseout|mouseover|mouseup|offline|online|open|pagehide|pageshow|paste|pause|play|playing|pointercancel|pointerdown|pointerenter|pointerleave|pointermove|pointerout|pointerover|pointerup|popstate|progress|ratechange|reset|resize|scroll|securitypolicyviolation|seeked|seeking|select|slotchange|stalled|storage|submit|suspend|timeupdate|toggle|touchcancel|touchend|touchmove|touchstart|transitioncancel|transitionend|transitionrun|transitionstart|unhandledrejection|unload|volumechange|waiting|wheel)\s*=/i;

// ---------------------------------------------------------------------------
// Color parsing utilities
// ---------------------------------------------------------------------------

/** Parse a hex color (#RGB, #RGBA, #RRGGBB, or #RRGGBBAA) to [R, G, B] — alpha is ignored */
const parseHex = (hex: string): [number, number, number] | null => {
  const trimmedHex = hex.trim();
  if (trimmedHex.length === 4) {
    // #RGB
    const c1 = trimmedHex[1] ?? '0';
    const c2 = trimmedHex[2] ?? '0';
    const c3 = trimmedHex[3] ?? '0';
    const red = parseInt(c1 + c1, 16);
    const green = parseInt(c2 + c2, 16);
    const blue = parseInt(c3 + c3, 16);
    if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) return null;
    return [red, green, blue];
  }
  if (trimmedHex.length === 5) {
    // #RGBA — expand each RGB digit, ignore alpha
    const c1 = trimmedHex[1] ?? '0';
    const c2 = trimmedHex[2] ?? '0';
    const c3 = trimmedHex[3] ?? '0';
    const red = parseInt(c1 + c1, 16);
    const green = parseInt(c2 + c2, 16);
    const blue = parseInt(c3 + c3, 16);
    if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) return null;
    return [red, green, blue];
  }
  if (trimmedHex.length === 7) {
    // #RRGGBB
    const red = parseInt(trimmedHex.slice(1, 3), 16);
    const green = parseInt(trimmedHex.slice(3, 5), 16);
    const blue = parseInt(trimmedHex.slice(5, 7), 16);
    if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) return null;
    return [red, green, blue];
  }
  if (trimmedHex.length === 9) {
    // #RRGGBBAA — parse RGB portion, ignore alpha
    const red = parseInt(trimmedHex.slice(1, 3), 16);
    const green = parseInt(trimmedHex.slice(3, 5), 16);
    const blue = parseInt(trimmedHex.slice(5, 7), 16);
    if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) return null;
    return [red, green, blue];
  }
  return null;
};

/** Convert HSL to RGB. hue is 0-360, saturation/lightness are 0-100 percentages. */
const hslToRgb = (hue: number, saturation: number, lightness: number): [number, number, number] => {
  const saturationNorm = saturation / 100;
  const lightnessNorm = lightness / 100;
  const chroma = (1 - Math.abs(2 * lightnessNorm - 1)) * saturationNorm;
  const secondaryComponent = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const lightnessMatch = lightnessNorm - chroma / 2;
  let redPrime: number, greenPrime: number, bluePrime: number;
  if (hue < 60) {
    [redPrime, greenPrime, bluePrime] = [chroma, secondaryComponent, 0];
  } else if (hue < 120) {
    [redPrime, greenPrime, bluePrime] = [secondaryComponent, chroma, 0];
  } else if (hue < 180) {
    [redPrime, greenPrime, bluePrime] = [0, chroma, secondaryComponent];
  } else if (hue < 240) {
    [redPrime, greenPrime, bluePrime] = [0, secondaryComponent, chroma];
  } else if (hue < 300) {
    [redPrime, greenPrime, bluePrime] = [secondaryComponent, 0, chroma];
  } else {
    [redPrime, greenPrime, bluePrime] = [chroma, 0, secondaryComponent];
  }
  return [
    Math.round((redPrime + lightnessMatch) * 255),
    Math.round((greenPrime + lightnessMatch) * 255),
    Math.round((bluePrime + lightnessMatch) * 255),
  ];
};

/** Compute luminance-equivalent gray value using ITU-R BT.709 */
const toLuminanceGray = (red: number, green: number, blue: number): number =>
  Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);

/**
 * Minimum gray value (0-255) for auto-generated inactive icons. Icons with
 * luminance below this threshold (e.g. black, very dark colors) are clamped
 * upward so the inactive variant is visibly lighter than the active one.
 * 153 corresponds to #999999 / HSL lightness 60%.
 */
const MIN_INACTIVE_GRAY = 153;

/** Equivalent HSL lightness (%) for MIN_INACTIVE_GRAY */
const MIN_INACTIVE_LIGHTNESS = Math.round((MIN_INACTIVE_GRAY / 255) * 100);

// ---------------------------------------------------------------------------
// Dark mode icon generation helpers
// ---------------------------------------------------------------------------

/** Convert RGB (0-255) to HSL. Returns [hue: 0-360, saturation: 0-100, lightness: 0-100]. */
const rgbToHsl = (red: number, green: number, blue: number): [number, number, number] => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness * 100];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    hue = ((b - r) / delta + 2) * 60;
  } else {
    hue = ((r - g) / delta + 4) * 60;
  }
  return [hue, saturation * 100, lightness * 100];
};

/**
 * WCAG 2.x relative luminance (0-1 scale).
 * Uses the sRGB linearization formula from WCAG 2.0 §1.4.3.
 */
const wcagRelativeLuminance = (red: number, green: number, blue: number): number => {
  const linearize = (c: number): number => {
    const srgb = c / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
};

/** WCAG contrast ratio between two relative luminance values (each 0-1). */
const contrastRatio = (lum1: number, lum2: number): number => {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
};

/** Dark card background color (#1c1c1c) relative luminance, precomputed. */
const DARK_BG_LUMINANCE = wcagRelativeLuminance(28, 28, 28);

/**
 * Minimum contrast ratio required for an icon color to be considered visible
 * against the dark card background. WCAG AA for large text / UI components is 3:1.
 */
const MIN_ICON_CONTRAST = 3;

/** Convert a gray value (0-255) to a two-digit hex string */
const grayToHex = (gray: number): string => {
  const hexPair = Math.max(0, Math.min(255, gray)).toString(16).padStart(2, '0');
  return `#${hexPair}${hexPair}${hexPair}`;
};

/** Parse a single RGB component: integer (0-255) or percentage string (e.g. "50%") → 0-255 */
const parseRgbComponent = (s: string): number => (s.endsWith('%') ? Math.round(parseFloat(s) * 2.55) : parseInt(s, 10));

/**
 * Parse a CSS color value into [R, G, B] or null if not a recognizable color.
 * Returns null for passthrough values (none, currentColor, etc.) and url() references.
 */
const parseColor = (value: string): [number, number, number] | null => {
  const trimmedValue = value.trim();
  const lowerValue = trimmedValue.toLowerCase();

  // Passthrough values
  if (PASSTHROUGH_VALUES.has(lowerValue)) return null;

  // URL references (e.g., url(#gradient))
  if (lowerValue.startsWith('url(')) return null;

  // Hex colors
  if (trimmedValue.startsWith('#')) return parseHex(trimmedValue);

  // rgb()/rgba() — legacy comma-separated syntax: rgb(R, G, B) or rgba(R, G, B, A)
  // Components may be integers (0-255) or decimal percentages (0%-100%, e.g. 12.54902%)
  const rgbMatch = lowerValue.match(/^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)/);
  if (rgbMatch) {
    return [
      parseRgbComponent(rgbMatch[1] ?? '0'),
      parseRgbComponent(rgbMatch[2] ?? '0'),
      parseRgbComponent(rgbMatch[3] ?? '0'),
    ];
  }

  // rgb()/rgba() — modern CSS Color Level 4 space-separated syntax: rgb(R G B) or rgb(R G B / A)
  // Components may be integers (0-255) or percentages (0%-100%)
  const modernRgbMatch = lowerValue.match(/^rgba?\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)(?:\s*\/\s*[\d.]+%?)?\s*\)$/);
  if (modernRgbMatch) {
    return [
      parseRgbComponent(modernRgbMatch[1] ?? '0'),
      parseRgbComponent(modernRgbMatch[2] ?? '0'),
      parseRgbComponent(modernRgbMatch[3] ?? '0'),
    ];
  }

  // hsl()/hsla() — comma-separated (legacy): hsl(H, S%, L%)
  const hslMatch = lowerValue.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
  if (hslMatch) {
    return hslToRgb(parseFloat(hslMatch[1] ?? '0'), parseFloat(hslMatch[2] ?? '0'), parseFloat(hslMatch[3] ?? '0'));
  }

  // hsl()/hsla() — space-separated (CSS4): hsl(H S% L%) or hsl(H S% L% / A)
  const modernHslMatch = lowerValue.match(/^hsla?\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*[\d.]+%?)?\s*\)$/);
  if (modernHslMatch) {
    return hslToRgb(
      parseFloat(modernHslMatch[1] ?? '0'),
      parseFloat(modernHslMatch[2] ?? '0'),
      parseFloat(modernHslMatch[3] ?? '0'),
    );
  }

  // Named colors
  const named = NAMED_COLORS[lowerValue];
  if (named) return named;

  return null;
};

/** Check if a parsed RGB is achromatic (R === G === B) */
const isAchromatic = (red: number, green: number, blue: number): boolean => red === green && green === blue;

/** Check if a CSS color string is achromatic (or a passthrough value) */
const isAchromaticColor = (value: string): boolean => {
  const normalizedValue = value.trim().toLowerCase();

  if (PASSTHROUGH_VALUES.has(normalizedValue)) return true;
  if (normalizedValue.startsWith('url(')) return true;
  if (ACHROMATIC_NAMES.has(normalizedValue)) return true;

  // hsl/hsla — check saturation is 0 (handles both comma-separated and space-separated syntax)
  const hslMatch = normalizedValue.match(/^hsla?\(\s*[\d.]+[\s,]+([\d.]+)%/);
  if (hslMatch) return parseFloat(hslMatch[1] ?? '0') === 0;

  const rgb = parseColor(normalizedValue);
  if (!rgb) return true; // Unrecognized values are considered achromatic
  return isAchromatic(rgb[0], rgb[1], rgb[2]);
};

// ---------------------------------------------------------------------------
// validateIconSvg
// ---------------------------------------------------------------------------

type ValidationResult = { valid: true } | { valid: false; errors: string[] };

/**
 * Validate an SVG string for use as a plugin icon.
 * Checks: size <= 16KB, viewBox present and square, no <image>/<script>,
 * no event handler attributes.
 */
const validateIconSvg = (content: string, _filename: string): ValidationResult => {
  const errors: string[] = [];

  // Size check (byte count, not string length)
  const byteSize = new TextEncoder().encode(content).byteLength;
  if (byteSize > MAX_ICON_SIZE) {
    errors.push(`SVG size (${byteSize} bytes) exceeds maximum of ${MAX_ICON_SIZE} bytes (16 KB)`);
  }

  // viewBox check
  const viewBoxMatch = content.match(/viewBox\s*=\s*["']([^"']*)["']/);
  if (!viewBoxMatch) {
    errors.push('SVG must have a viewBox attribute');
  } else {
    const viewBoxValue = viewBoxMatch[1] ?? '';
    const parts = viewBoxValue.trim().split(/\s+/);
    if (parts.length === 4) {
      const viewBoxWidth = parseFloat(parts[2] ?? '0');
      const viewBoxHeight = parseFloat(parts[3] ?? '0');
      if (viewBoxWidth !== viewBoxHeight) {
        errors.push(`SVG viewBox must be square (got ${viewBoxWidth}x${viewBoxHeight})`);
      }
    } else {
      errors.push('SVG viewBox must have exactly 4 values (min-x min-y width height)');
    }
  }

  // Forbidden elements: <image>
  if (/<image[\s/>]/i.test(content)) {
    errors.push('SVG must not contain <image> elements');
  }

  // Forbidden elements: <script>
  if (/<script[\s/>]/i.test(content)) {
    errors.push('SVG must not contain <script> elements');
  }

  // Event handler attributes
  if (EVENT_HANDLER_RE.test(content)) {
    errors.push('SVG must not contain event handler attributes (e.g., onclick, onload, onerror)');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
};

// ---------------------------------------------------------------------------
// validateInactiveIconColors
// ---------------------------------------------------------------------------

/**
 * Validate that an SVG contains only achromatic colors.
 * Checks fill, stroke, stop-color, and flood-color in attributes, inline styles,
 * and <style> blocks.
 */
const validateInactiveIconColors = (content: string): ValidationResult => {
  const errors: string[] = [];

  // Check attribute values: (fill|stroke|stop-color|flood-color)="value" or ='value'
  const attrPattern = new RegExp(`(${COLOR_ATTRS.join('|')})\\s*=\\s*["']([^"']*)["']`, 'gi');
  let attrMatch;
  while ((attrMatch = attrPattern.exec(content)) !== null) {
    const attr = attrMatch[1] ?? '';
    const value = (attrMatch[2] ?? '').trim();
    if (value && !isAchromaticColor(value)) {
      errors.push(`Attribute ${attr}="${value}" uses a saturated color`);
    }
  }

  // Check inline style property values: style="fill: value; stroke: value" or style='...'
  const stylePattern = /style\s*=\s*["']([^"']*)["']/gi;
  let styleMatch;
  while ((styleMatch = stylePattern.exec(content)) !== null) {
    const styleValue = styleMatch[1] ?? '';
    for (const attr of COLOR_ATTRS) {
      const propPattern = new RegExp(`${attr.replace('-', '\\-')}\\s*:\\s*([^;"']+)`, 'gi');
      let propMatch;
      while ((propMatch = propPattern.exec(styleValue)) !== null) {
        const value = (propMatch[1] ?? '').trim();
        if (value && !isAchromaticColor(value)) {
          errors.push(`Style property ${attr}: ${value} uses a saturated color`);
        }
      }
    }
  }

  // Check <style> blocks for color declarations
  const styleBlockPattern = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleBlockMatch;
  while ((styleBlockMatch = styleBlockPattern.exec(content)) !== null) {
    const cssContent = styleBlockMatch[1] ?? '';
    for (const attr of COLOR_ATTRS) {
      const cssPropPattern = new RegExp(`${attr.replace('-', '\\-')}\\s*:\\s*([^;}"']+)`, 'gi');
      let cssPropMatch;
      while ((cssPropMatch = cssPropPattern.exec(cssContent)) !== null) {
        const value = (cssPropMatch[1] ?? '').trim();
        if (value && !isAchromaticColor(value)) {
          errors.push(`<style> property ${attr}: ${value} uses a saturated color`);
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
};

// ---------------------------------------------------------------------------
// generateInactiveIcon
// ---------------------------------------------------------------------------

/**
 * Convert a single color value to its grayscale equivalent.
 * Returns the original value for passthrough values (none, currentColor, etc.)
 */
const convertColorToGray = (value: string): string => {
  const trimmedValue = value.trim();
  const lowerValue = trimmedValue.toLowerCase();

  if (PASSTHROUGH_VALUES.has(lowerValue)) return trimmedValue;
  if (lowerValue.startsWith('url(')) return trimmedValue;

  // hsl/hsla — comma-separated (legacy): set saturation to 0, clamp lightness to minimum
  const hslaMatch = lowerValue.match(/^(hsla?)\(\s*([\d.]+)\s*,\s*[\d.]+%\s*,\s*([\d.]+)(%)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (hslaMatch) {
    const fn = hslaMatch[1] ?? 'hsl';
    const hue = hslaMatch[2] ?? '0';
    const lightness = Math.max(MIN_INACTIVE_LIGHTNESS, parseFloat(hslaMatch[3] ?? '50'));
    const alpha = hslaMatch[5];
    if (alpha !== undefined) {
      return `${fn}(${hue}, 0%, ${lightness}%, ${alpha})`;
    }
    return `${fn}(${hue}, 0%, ${lightness}%)`;
  }

  // hsl/hsla — space-separated (CSS4): set saturation to 0, clamp lightness to minimum
  const modernHslaMatch = lowerValue.match(/^(hsla?)\(\s*([\d.]+)\s+[\d.]+%\s+([\d.]+)%(.*)\)$/);
  if (modernHslaMatch) {
    const fn = modernHslaMatch[1] ?? 'hsl';
    const hue = modernHslaMatch[2] ?? '0';
    const lightness = Math.max(MIN_INACTIVE_LIGHTNESS, parseFloat(modernHslaMatch[3] ?? '50'));
    const rest = modernHslaMatch[4] ?? '';
    return `${fn}(${hue} 0% ${lightness}%${rest})`;
  }

  // rgba() — legacy comma-separated with optional decimal percentage components: rgba(R, G, B, A)
  // Alpha accepts numeric (0.5) or percentage (50%) values.
  const rgbaMatch = lowerValue.match(/^rgba\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*\)/);
  if (rgbaMatch) {
    const red = parseRgbComponent(rgbaMatch[1] ?? '0');
    const green = parseRgbComponent(rgbaMatch[2] ?? '0');
    const blue = parseRgbComponent(rgbaMatch[3] ?? '0');
    const alpha = rgbaMatch[4] ?? '1';
    const gray = Math.max(MIN_INACTIVE_GRAY, toLuminanceGray(red, green, blue));
    return `rgba(${gray}, ${gray}, ${gray}, ${alpha})`;
  }

  // rgb()/rgba() — legacy comma-separated with optional decimal percentage components: rgb(R, G, B) or rgba(R, G, B)
  // rgba() without an alpha parameter is treated as fully opaque and converted to hex.
  const rgbMatch = lowerValue.match(/^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*\)/);
  if (rgbMatch) {
    const red = parseRgbComponent(rgbMatch[1] ?? '0');
    const green = parseRgbComponent(rgbMatch[2] ?? '0');
    const blue = parseRgbComponent(rgbMatch[3] ?? '0');
    const gray = Math.max(MIN_INACTIVE_GRAY, toLuminanceGray(red, green, blue));
    return grayToHex(gray);
  }

  // rgb()/rgba() — modern CSS Color Level 4 space-separated: rgb(R G B) or rgb(R G B / A)
  const modernRgbConvertMatch = lowerValue.match(
    /^rgba?\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/,
  );
  if (modernRgbConvertMatch) {
    const red = parseRgbComponent(modernRgbConvertMatch[1] ?? '0');
    const green = parseRgbComponent(modernRgbConvertMatch[2] ?? '0');
    const blue = parseRgbComponent(modernRgbConvertMatch[3] ?? '0');
    const alpha = modernRgbConvertMatch[4];
    const gray = Math.max(MIN_INACTIVE_GRAY, toLuminanceGray(red, green, blue));
    if (alpha !== undefined) {
      return `rgba(${gray}, ${gray}, ${gray}, ${alpha})`;
    }
    return grayToHex(gray);
  }

  // Hex colors
  if (trimmedValue.startsWith('#')) {
    const rgb = parseHex(trimmedValue);
    if (rgb) {
      const gray = Math.max(MIN_INACTIVE_GRAY, toLuminanceGray(rgb[0], rgb[1], rgb[2]));
      return grayToHex(gray);
    }
    return trimmedValue;
  }

  // Named colors
  const named = NAMED_COLORS[lowerValue];
  if (named) {
    const gray = Math.max(MIN_INACTIVE_GRAY, toLuminanceGray(named[0], named[1], named[2]));
    return grayToHex(gray);
  }

  return trimmedValue;
};

/**
 * Convert all color values in an SVG to luminance-equivalent grays.
 * Processes fill, stroke, stop-color, and flood-color in attributes, inline styles,
 * and <style> blocks.
 * Uses ITU-R BT.709: gray = 0.2126*R + 0.7152*G + 0.0722*B
 */
const generateInactiveIcon = (svgContent: string): string => {
  let result = svgContent;

  // Convert attribute values: (fill|stroke|stop-color|flood-color)="value" or ='value'
  const attrPattern = new RegExp(`((?:${COLOR_ATTRS.join('|')})\\s*=\\s*)(["'])([^"']*)(\\2)`, 'gi');
  result = result.replace(attrPattern, (_match, prefix: string, quote: string, value: string) => {
    const converted = convertColorToGray(value);
    return `${prefix}${quote}${converted}${quote}`;
  });

  // Convert inline style property values: style="..." or style='...'
  const stylePattern = /style\s*=\s*["']([^"']*)["']/gi;
  result = result.replace(stylePattern, (fullMatch, styleValue: string) => {
    let newStyle = styleValue;
    for (const attr of COLOR_ATTRS) {
      const propPattern = new RegExp(`(${attr.replace('-', '\\-')}\\s*:\\s*)([^;"']+)`, 'gi');
      newStyle = newStyle.replace(propPattern, (_m, propPrefix: string, propValue: string) => {
        const converted = convertColorToGray(propValue);
        return `${propPrefix}${converted}`;
      });
    }
    return fullMatch.replace(styleValue, () => newStyle);
  });

  // Convert colors in <style> blocks
  const styleBlockPattern = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi;
  result = result.replace(styleBlockPattern, (_fullMatch, openTag: string, cssContent: string, closeTag: string) => {
    let newCss = cssContent;
    for (const attr of COLOR_ATTRS) {
      const cssPropPattern = new RegExp(`(${attr.replace('-', '\\-')}\\s*:\\s*)([^;}"']+)`, 'gi');
      newCss = newCss.replace(cssPropPattern, (_m, propPrefix: string, propValue: string) => {
        const converted = convertColorToGray(propValue);
        return `${propPrefix}${converted}`;
      });
    }
    return `${openTag}${newCss}${closeTag}`;
  });

  return result;
};

// ---------------------------------------------------------------------------
// generateDarkIcon
// ---------------------------------------------------------------------------

/**
 * Adapt a single color value for dark mode by inverting its lightness when the
 * color has insufficient contrast against the dark card background (#1c1c1c).
 *
 * Colors with a WCAG contrast ratio >= 3:1 against #1c1c1c are left unchanged
 * (they are already visible on dark backgrounds — e.g. Slack's brand colors,
 * Discord's blurple). Colors below that threshold (e.g. black, dark grays) have
 * their HSL lightness inverted (L → 100% - L) so they become light enough to see.
 *
 * Passthrough values (none, currentColor, url(), etc.) are returned as-is.
 */
const convertColorForDark = (value: string): string => {
  const trimmedValue = value.trim();
  const lowerValue = trimmedValue.toLowerCase();

  if (PASSTHROUGH_VALUES.has(lowerValue)) return trimmedValue;
  if (lowerValue.startsWith('url(')) return trimmedValue;

  const rgb = parseColor(trimmedValue);
  if (!rgb) return trimmedValue;

  const lum = wcagRelativeLuminance(rgb[0], rgb[1], rgb[2]);
  const ratio = contrastRatio(lum, DARK_BG_LUMINANCE);

  // Color already has sufficient contrast against the dark background — keep it
  if (ratio >= MIN_ICON_CONTRAST) return trimmedValue;

  // Invert lightness in HSL space to make the color visible on dark backgrounds.
  // For colors near L=50% (e.g. pure blue #0000ff at HSL 240,100%,50%), inversion
  // produces the same lightness. If the inverted color still lacks contrast, boost
  // lightness until the minimum contrast threshold is met.
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  let newL = 100 - l;

  const checkContrast = (lightness: number): boolean => {
    const testRgb = hslToRgb(h, s, lightness);
    const testLum = wcagRelativeLuminance(testRgb[0], testRgb[1], testRgb[2]);
    return contrastRatio(testLum, DARK_BG_LUMINANCE) >= MIN_ICON_CONTRAST;
  };

  if (!checkContrast(newL)) {
    while (newL < 100) {
      newL = Math.min(newL + 5, 100);
      if (checkContrast(newL)) break;
    }
  }

  const [newR, newG, newB] = hslToRgb(h, s, newL);
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
};

/**
 * Generate a dark-mode variant of an SVG icon by selectively adapting colors
 * that would be invisible or hard to see against a dark background (#1c1c1c).
 *
 * Colors with sufficient contrast (>= 3:1 WCAG) against the dark card background
 * are left unchanged — colorful brand icons (Slack, Discord) pass through untouched.
 * Dark colors (black, dark grays) have their lightness inverted in HSL space so they
 * become visible on dark backgrounds.
 *
 * Uses the same SVG color processing pipeline as generateInactiveIcon: attributes,
 * inline styles, and <style> blocks are all handled.
 */
const generateDarkIcon = (svgContent: string): string => {
  let result = svgContent;

  // Convert attribute values: (fill|stroke|stop-color|flood-color)="value" or ='value'
  const attrPattern = new RegExp(`((?:${COLOR_ATTRS.join('|')})\\s*=\\s*)(["'])([^"']*)(\\2)`, 'gi');
  result = result.replace(attrPattern, (_match, prefix: string, quote: string, value: string) => {
    const converted = convertColorForDark(value);
    return `${prefix}${quote}${converted}${quote}`;
  });

  // Convert inline style property values: style="..." or style='...'
  const stylePattern = /style\s*=\s*["']([^"']*)["']/gi;
  result = result.replace(stylePattern, (fullMatch, styleValue: string) => {
    let newStyle = styleValue;
    for (const attr of COLOR_ATTRS) {
      const propPattern = new RegExp(`(${attr.replace('-', '\\-')}\\s*:\\s*)([^;"']+)`, 'gi');
      newStyle = newStyle.replace(propPattern, (_m, propPrefix: string, propValue: string) => {
        const converted = convertColorForDark(propValue);
        return `${propPrefix}${converted}`;
      });
    }
    return fullMatch.replace(styleValue, () => newStyle);
  });

  // Convert colors in <style> blocks
  const styleBlockPattern = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi;
  result = result.replace(styleBlockPattern, (_fullMatch, openTag: string, cssContent: string, closeTag: string) => {
    let newCss = cssContent;
    for (const attr of COLOR_ATTRS) {
      const cssPropPattern = new RegExp(`(${attr.replace('-', '\\-')}\\s*:\\s*)([^;}"']+)`, 'gi');
      newCss = newCss.replace(cssPropPattern, (_m, propPrefix: string, propValue: string) => {
        const converted = convertColorForDark(propValue);
        return `${propPrefix}${converted}`;
      });
    }
    return `${openTag}${newCss}${closeTag}`;
  });

  return result;
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const namespaceSvgIds = (svgContent: string, prefix: string): string => {
  const ids = Array.from(svgContent.matchAll(/\bid\s*=\s*"([^"]+)"/g), m => m[1] as string);

  if (ids.length === 0) return svgContent;

  let result = svgContent;
  for (const id of ids) {
    const escaped = escapeRegExp(id);
    result = result.replace(new RegExp(`\\bid\\s*=\\s*"${escaped}"`, 'g'), `id="${prefix}-${id}"`);
    result = result.replace(new RegExp(`url\\(#${escaped}\\)`, 'g'), `url(#${prefix}-${id})`);
    result = result.replace(new RegExp(`href="#${escaped}"`, 'g'), `href="#${prefix}-${id}"`);
    result = result.replace(new RegExp(`xlink:href="#${escaped}"`, 'g'), `xlink:href="#${prefix}-${id}"`);
  }

  return result;
};

export {
  DARK_BG_LUMINANCE,
  generateDarkIcon,
  generateInactiveIcon,
  MAX_ICON_SIZE,
  MIN_ICON_CONTRAST,
  MIN_INACTIVE_GRAY,
  namespaceSvgIds,
  validateIconSvg,
  validateInactiveIconColors,
};
