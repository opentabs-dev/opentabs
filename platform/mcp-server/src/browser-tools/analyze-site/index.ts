/**
 * Site analyzer orchestrator.
 *
 * Collects data from the page using browser tool handlers (open tab, network
 * capture, execute script, get cookies, get storage, get network requests),
 * then passes the collected data through each detection module to produce a
 * comprehensive site analysis report.
 */

import { deleteExecFile, dispatchToExtension, writeExecFile } from '../../extension-protocol.js';
import type { ExtensionConnection, ServerState } from '../../state.js';
import { getAnyConnection, getConnectionForTab } from '../../state.js';
import { validateDispatchResult } from '../dispatch-utils.js';
import type { ApiAnalysis, ApiEndpoint, WsFrame } from './detect-apis.js';
import { detectApis } from './detect-apis.js';
import type {
  AuthAnalysis,
  CookieEntry,
  CsrfDomToken,
  GlobalEntry,
  NetworkRequest,
  StorageEntry,
} from './detect-auth.js';
import { detectAuth } from './detect-auth.js';
import type { DomAnalysis, FormInput, InteractiveElementInput } from './detect-dom.js';
import { detectDom } from './detect-dom.js';
import type { FrameworkAnalysis, FrameworkProbe } from './detect-framework.js';
import { deduplicateFrameworkProbes, detectFramework } from './detect-framework.js';
import type { GlobalProperty, GlobalsAnalysis } from './detect-globals.js';
import { detectGlobals } from './detect-globals.js';
import type { StorageAnalysis } from './detect-storage.js';
import { detectStorage } from './detect-storage.js';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** A concrete plugin tool idea derived from detected APIs, forms, or endpoints. */
interface ToolSuggestion {
  toolName: string;
  description: string;
  approach: string;
  complexity: 'low' | 'medium' | 'high';
}

/** Comprehensive site analysis report combining all detection module results and tool suggestions. */
interface SiteAnalysis {
  url: string;
  title: string;
  auth: AuthAnalysis;
  apis: ApiAnalysis;
  framework: FrameworkAnalysis;
  globals: GlobalsAnalysis;
  dom: DomAnalysis;
  storage: StorageAnalysis;
  suggestions: ToolSuggestion[];
}

// ---------------------------------------------------------------------------
// Script execution helper
// ---------------------------------------------------------------------------

/**
 * Execute JavaScript in a tab's MAIN world and return the result.
 * Uses the file-based injection pattern (writeExecFile → dispatchToExtension → deleteExecFile)
 * to bypass page CSP restrictions.
 */
const executeInTab = async (state: ServerState, tabId: number, code: string): Promise<unknown> => {
  const execId = crypto.randomUUID();
  const filename = await writeExecFile(state, execId, code);
  try {
    const result = (await dispatchToExtension(state, 'browser.executeScript', {
      tabId,
      execFile: filename,
    })) as { value?: { value?: unknown; error?: string } } | undefined;

    // Unwrap the nested result from browser.executeScript:
    // The extension returns { value: { value: <actual>, error?: <msg> } }
    const inner = result?.value;
    if (inner?.error) {
      throw new Error(`Script execution error: ${inner.error}`);
    }
    const value = inner?.value;
    if (typeof value === 'string' && value.length > 0 && (value[0] === '{' || value[0] === '[')) {
      // Chrome sometimes truncates large JSON payloads to a string. If the
      // string is valid JSON, return the parsed value; otherwise it's a
      // truncation artifact and we return null so callers fall back to defaults.
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value ?? null;
  } finally {
    try {
      await deleteExecFile(filename);
    } catch {
      // Best-effort cleanup
    }
  }
};

// ---------------------------------------------------------------------------
// Page-context scripts
// ---------------------------------------------------------------------------

/**
 * Returns JS code that collects CSRF tokens from meta tags and hidden inputs.
 * Runs in the page context (MAIN world).
 */
const CSRF_SCRIPT = `
  const tokens = [];
  // Meta tags
  for (const meta of document.querySelectorAll('meta[name]')) {
    const name = (meta.getAttribute('name') || '').toLowerCase();
    if (name === 'csrf-token' || name === '_csrf' || name === 'csrf_token' || name === 'csrf') {
      const value = meta.getAttribute('content') || '';
      if (value) tokens.push({ source: 'meta', name: meta.getAttribute('name'), value });
    }
  }
  // Hidden inputs
  for (const input of document.querySelectorAll('input[type="hidden"]')) {
    const name = (input.getAttribute('name') || '').toLowerCase();
    if (name === 'authenticity_token' || name === '_token' || name === 'csrfmiddlewaretoken' || name === '__requestverificationtoken' || name === '_csrf' || name === 'csrf_token') {
      tokens.push({ source: 'hidden-input', name: input.getAttribute('name'), value: input.value });
    }
  }
  return tokens;
`;

/**
 * Returns JS code that probes for well-known SSR globals and extracts nested auth data.
 * Runs in the page context.
 */
const GLOBALS_AUTH_SCRIPT = `
  const paths = ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APP_STATE__'];
  const results = [];
  for (const path of paths) {
    if (typeof window[path] !== 'undefined') {
      results.push({ path, value: window[path] });
    }
  }
  return results;
`;

/**
 * Returns JS code that detects frameworks by probing globals and DOM markers.
 */
const FRAMEWORK_PROBE_SCRIPT = `
  const probes = [];

  // React
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    let version;
    try {
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook.renderers && hook.renderers.size > 0) {
        const renderer = hook.renderers.values().next().value;
        if (renderer && renderer.version) version = renderer.version;
      }
    } catch {}
    probes.push({ name: 'react', version });
  }

  // Next.js
  if (window.__NEXT_DATA__) {
    let version;
    try { version = window.__NEXT_DATA__.buildId; } catch {}
    probes.push({ name: 'nextjs', version });
  }

  // Vue
  if (window.__VUE__) {
    probes.push({ name: 'vue', version: undefined });
  }
  if (window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    const hook = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    if (hook.Vue) {
      probes.push({ name: 'vue', version: hook.Vue.version });
    }
  }

  // Nuxt
  if (window.__NUXT__) {
    probes.push({ name: 'nuxt', version: undefined });
  }

  // Angular — look for ng-version attribute
  const ngEl = document.querySelector('[ng-version]');
  if (ngEl) {
    probes.push({ name: 'angular', version: ngEl.getAttribute('ng-version') || undefined });
  }

  // Svelte
  if (window.__svelte_meta || document.querySelector('[data-svelte-h]')) {
    probes.push({ name: 'svelte', version: undefined });
  }

  // jQuery
  if (window.jQuery || window.$) {
    const jq = window.jQuery || window.$;
    probes.push({ name: 'jquery', version: typeof jq.fn === 'object' ? jq.fn.jquery : undefined });
  }

  // Ember
  if (window.Ember) {
    probes.push({ name: 'ember', version: window.Ember.VERSION || undefined });
  }

  // Backbone
  if (window.Backbone) {
    probes.push({ name: 'backbone', version: window.Backbone.VERSION || undefined });
  }

  return probes;
`;

/**
 * Returns JS code that detects SPA/SSR signals.
 */
const SPA_SSR_PROBE_SCRIPT = `
  // Single root element check
  const body = document.body;
  const children = body ? Array.from(body.children).filter(el => {
    const tag = el.tagName.toLowerCase();
    return tag !== 'script' && tag !== 'style' && tag !== 'link' && tag !== 'noscript';
  }) : [];
  const hasSingleRootElement = children.length === 1;

  // pushState evidence: check for known SPA container IDs
  const spaContainerIds = ['root', 'app', '__next', '__nuxt', 'svelte'];
  const hasKnownSpaContainer = spaContainerIds.some(id => document.getElementById(id) !== null);
  const usesPushState = hasKnownSpaContainer;

  const hasNextData = typeof window.__NEXT_DATA__ !== 'undefined';
  const hasNuxtData = typeof window.__NUXT__ !== 'undefined';

  // Hydration markers
  const hasHydrationMarkers = !!(
    document.querySelector('[data-reactroot]') ||
    document.querySelector('[data-server-rendered]') ||
    document.querySelector('[data-react-helmet]') ||
    (window.__NEXT_DATA__ && window.__NEXT_DATA__.props)
  );

  return { hasSingleRootElement, usesPushState, hasNextData, hasNuxtData, hasHydrationMarkers };
`;

/**
 * Returns JS code that scans window globals for non-standard properties.
 */
const GLOBALS_SCAN_SCRIPT = `
  const BROWSER_BUILTINS = new Set([
    'undefined','NaN','Infinity','globalThis','window','self','document','name','location',
    'customElements','history','navigation','locationbar','menubar','personalbar',
    'scrollbars','statusbar','toolbar','status','closed','frames','length','top',
    'opener','parent','frameElement','navigator','origin','external','screen',
    'visualViewport','innerWidth','innerHeight','outerWidth','outerHeight',
    'devicePixelRatio','clientInformation','screenX','screenY','screenLeft',
    'screenTop','styleMedia','onsearch','isSecureContext','crossOriginIsolated',
    'performance','caches','cookieStore','onappinstalled','onbeforeinstallprompt',
    'crypto','indexedDB','sessionStorage','localStorage','chrome','speechSynthesis',
    'webkitRequestAnimationFrame','webkitCancelAnimationFrame','fetch',
    'alert','atob','blur','btoa','cancelAnimationFrame','cancelIdleCallback',
    'captureEvents','clearInterval','clearTimeout','close','confirm',
    'createImageBitmap','find','focus','getComputedStyle','getSelection',
    'matchMedia','moveBy','moveTo','open','postMessage','print','prompt',
    'queueMicrotask','releaseEvents','reportError','requestAnimationFrame',
    'requestIdleCallback','resizeBy','resizeTo','scroll','scrollBy','scrollTo',
    'setInterval','setTimeout','stop','structuredClone','webkitRequestFileSystem',
    'webkitResolveLocalFileSystemURL','addEventListener','removeEventListener',
    'dispatchEvent','getScreenDetails','queryLocalFonts','showDirectoryPicker',
    'showOpenFilePicker','showSavePicker','originAgentCluster','trustedTypes',
    'screenIsExtended','onscreenchange','credentialless','documentPictureInPicture',
    'launchQueue','sharedStorage','onpageswap','onpagereveal','onpageshow',
    'onpagehide','onbeforeunload','onunload','onload','onerror','onmessage',
    'onmessageerror','onpopstate','onrejectionhandled','onstorage',
    'onunhandledrejection','onhashchange','onlanguagechange','onbeforetoggle',
    'oncontentvisibilityautostatechange','onscrollend','onbeforematch',
    'onauxclick','onblur','oncancel','oncanplay','oncanplaythrough','onchange',
    'onclick','onclose','oncontextlost','oncontextmenu','oncontextrestored',
    'oncuechange','ondblclick','ondrag','ondragend','ondragenter','ondragleave',
    'ondragover','ondragstart','ondrop','ondurationchange','onemptied','onended',
    'onfocus','onformdata','ongotpointercapture','oninput','oninvalid',
    'onkeydown','onkeypress','onkeyup','onloadeddata','onloadedmetadata',
    'onloadstart','onlostpointercapture','onmousedown','onmouseenter',
    'onmouseleave','onmousemove','onmouseout','onmouseover','onmouseup',
    'onmousewheel','onpause','onplay','onplaying','onpointercancel',
    'onpointerdown','onpointerenter','onpointerleave','onpointermove',
    'onpointerout','onpointerover','onpointerrawupdate','onpointerup',
    'onprogress','onratechange','onreset','onresize','onscroll',
    'onsecuritypolicyviolation','onseeked','onseeking','onselect',
    'onselectionchange','onselectstart','onslotchange','onstalled','onsubmit',
    'onsuspend','ontimeupdate','ontoggle','ontransitioncancel','ontransitionend',
    'ontransitionrun','ontransitionstart','onvolumechange','onwaiting',
    'onwebkitanimationend','onwebkitanimationiteration','onwebkitanimationstart',
    'onwebkittransitionend','onwheel','onanimationend','onanimationiteration',
    'onanimationstart','onabeforeprint','onafterprint','onbeforexrselect',
    'onabort','onbeforeinput','onbeforecopy','onbeforecut','onbeforepaste',
    'oncopy','oncut','onpaste','onfreeze','onresume','scheduler','onbeforeprint',
    'onafterprint','Array','ArrayBuffer','BigInt','BigInt64Array','BigUint64Array',
    'Boolean','DataView','Date','Error','EvalError','FinalizationRegistry',
    'Float32Array','Float64Array','Function','Int16Array','Int32Array','Int8Array',
    'Map','Number','Object','Promise','Proxy','RangeError','ReferenceError',
    'RegExp','Set','SharedArrayBuffer','String','Symbol','SyntaxError','TypeError',
    'URIError','Uint16Array','Uint32Array','Uint8Array','Uint8ClampedArray',
    'WeakMap','WeakRef','WeakSet','decodeURI','decodeURIComponent','encodeURI',
    'encodeURIComponent','escape','eval','isFinite','isNaN','parseFloat','parseInt',
    'unescape','AbortController','AbortSignal','Blob','BroadcastChannel',
    'ByteLengthQueuingStrategy','CSS','CSSAnimation','CSSConditionRule',
    'CSSFontFaceRule','CSSGroupingRule','CSSKeyframeRule','CSSKeyframesRule',
    'CSSLayerBlockRule','CSSLayerStatementRule','CSSMediaRule','CSSNamespaceRule',
    'CSSPageRule','CSSPropertyRule','CSSRule','CSSRuleList','CSSStyleDeclaration',
    'CSSStyleRule','CSSStyleSheet','CSSSupportsRule','CSSTransition',
    'Cache','CacheStorage','CanvasGradient','CanvasPattern',
    'CanvasRenderingContext2D','ClipboardEvent','CloseEvent','Comment',
    'CompositionEvent','CountQueuingStrategy','CustomElementRegistry',
    'CustomEvent','DOMException','DOMImplementation','DOMMatrix',
    'DOMMatrixReadOnly','DOMParser','DOMPoint','DOMPointReadOnly','DOMQuad',
    'DOMRect','DOMRectList','DOMRectReadOnly','DOMStringList','DOMStringMap',
    'DOMTokenList','Document','DocumentFragment','DocumentType','Element',
    'ErrorEvent','Event','EventSource','EventTarget','File','FileList',
    'FileReader','FocusEvent','FontFace','FontFaceSet','FormData',
    'FormDataEvent','HTMLAllCollection','HTMLAnchorElement','HTMLAreaElement',
    'HTMLAudioElement','HTMLBRElement','HTMLBaseElement','HTMLBodyElement',
    'HTMLButtonElement','HTMLCanvasElement','HTMLCollection','HTMLDListElement',
    'HTMLDataElement','HTMLDataListElement','HTMLDetailsElement','HTMLDialogElement',
    'HTMLDirectoryElement','HTMLDivElement','HTMLDocument','HTMLElement',
    'HTMLEmbedElement','HTMLFieldSetElement','HTMLFontElement','HTMLFormElement',
    'HTMLFrameElement','HTMLFrameSetElement','HTMLHRElement','HTMLHeadElement',
    'HTMLHeadingElement','HTMLHtmlElement','HTMLIFrameElement','HTMLImageElement',
    'HTMLInputElement','HTMLLIElement','HTMLLabelElement','HTMLLegendElement',
    'HTMLLinkElement','HTMLMapElement','HTMLMarqueeElement','HTMLMediaElement',
    'HTMLMenuElement','HTMLMetaElement','HTMLMeterElement','HTMLModElement',
    'HTMLOListElement','HTMLObjectElement','HTMLOptGroupElement','HTMLOptionElement',
    'HTMLOutputElement','HTMLParagraphElement','HTMLParamElement','HTMLPictureElement',
    'HTMLPreElement','HTMLProgressElement','HTMLQuoteElement','HTMLScriptElement',
    'HTMLSelectElement','HTMLSlotElement','HTMLSourceElement','HTMLSpanElement',
    'HTMLStyleElement','HTMLTableCaptionElement','HTMLTableCellElement',
    'HTMLTableColElement','HTMLTableElement','HTMLTableRowElement',
    'HTMLTableSectionElement','HTMLTemplateElement','HTMLTextAreaElement',
    'HTMLTimeElement','HTMLTitleElement','HTMLTrackElement','HTMLUListElement',
    'HTMLUnknownElement','HTMLVideoElement','HashChangeEvent','Headers',
    'History','IDBCursor','IDBCursorWithValue','IDBDatabase','IDBFactory',
    'IDBIndex','IDBKeyRange','IDBObjectStore','IDBOpenDBRequest','IDBRequest',
    'IDBTransaction','IDBVersionChangeEvent','Image','ImageBitmap',
    'ImageBitmapRenderingContext','ImageData','InputEvent','IntersectionObserver',
    'IntersectionObserverEntry','JSON','KeyboardEvent','Location',
    'MathMLElement','MediaEncryptedEvent','MediaError','MediaList',
    'MediaQueryList','MediaQueryListEvent','MediaSource','MessageChannel',
    'MessageEvent','MessagePort','MouseEvent','MutationEvent','MutationObserver',
    'MutationRecord','NamedNodeMap','Navigator','Node','NodeFilter',
    'NodeIterator','NodeList','Notification','OfflineAudioCompletionEvent',
    'OffscreenCanvas','OffscreenCanvasRenderingContext2D','Option',
    'PageTransitionEvent','Path2D','Performance','PerformanceEntry',
    'PerformanceMark','PerformanceMeasure','PerformanceNavigation',
    'PerformanceNavigationTiming','PerformanceObserver','PerformanceObserverEntryList',
    'PerformancePaintTiming','PerformanceResourceTiming','PerformanceServerTiming',
    'PerformanceTiming','PointerEvent','PopStateEvent','ProcessingInstruction',
    'ProgressEvent','PromiseRejectionEvent','Range','ReadableByteStreamController',
    'ReadableStream','ReadableStreamBYOBReader','ReadableStreamBYOBRequest',
    'ReadableStreamDefaultController','ReadableStreamDefaultReader','Request',
    'ResizeObserver','ResizeObserverEntry','ResizeObserverSize','Response',
    'SVGAElement','SVGAngle','SVGAnimateElement','SVGAnimateMotionElement',
    'SVGAnimateTransformElement','SVGAnimatedAngle','SVGAnimatedBoolean',
    'SVGAnimatedEnumeration','SVGAnimatedInteger','SVGAnimatedLength',
    'SVGAnimatedLengthList','SVGAnimatedNumber','SVGAnimatedNumberList',
    'SVGAnimatedPreserveAspectRatio','SVGAnimatedRect','SVGAnimatedString',
    'SVGAnimatedTransformList','SVGAnimationElement','SVGCircleElement',
    'SVGClipPathElement','SVGComponentTransferFunctionElement','SVGDefsElement',
    'SVGDescElement','SVGElement','SVGEllipseElement','SVGFEBlendElement',
    'SVGFEColorMatrixElement','SVGFEComponentTransferElement',
    'SVGFECompositeElement','SVGFEConvolveMatrixElement',
    'SVGFEDiffuseLightingElement','SVGFEDisplacementMapElement',
    'SVGFEDistantLightElement','SVGFEDropShadowElement','SVGFEFloodElement',
    'SVGFEFuncAElement','SVGFEFuncBElement','SVGFEFuncGElement',
    'SVGFEFuncRElement','SVGFEGaussianBlurElement','SVGFEImageElement',
    'SVGFEMergeElement','SVGFEMergeNodeElement','SVGFEMorphologyElement',
    'SVGFEOffsetElement','SVGFEPointLightElement',
    'SVGFESpecularLightingElement','SVGFESpotLightElement','SVGFETileElement',
    'SVGFETurbulenceElement','SVGFilterElement','SVGForeignObjectElement',
    'SVGGElement','SVGGeometryElement','SVGGradientElement','SVGGraphicsElement',
    'SVGImageElement','SVGLength','SVGLengthList','SVGLineElement',
    'SVGLinearGradientElement','SVGMPathElement','SVGMarkerElement',
    'SVGMaskElement','SVGMatrix','SVGMetadataElement','SVGNumber',
    'SVGNumberList','SVGPathElement','SVGPatternElement','SVGPoint',
    'SVGPointList','SVGPolygonElement','SVGPolylineElement',
    'SVGPreserveAspectRatio','SVGRadialGradientElement','SVGRect',
    'SVGRectElement','SVGSVGElement','SVGScriptElement','SVGSetElement',
    'SVGStopElement','SVGStringList','SVGStyleElement','SVGSwitchElement',
    'SVGSymbolElement','SVGTSpanElement','SVGTextContentElement',
    'SVGTextElement','SVGTextPathElement','SVGTextPositioningElement',
    'SVGTitleElement','SVGTransform','SVGTransformList','SVGUnitTypes',
    'SVGUseElement','SVGViewElement','Screen','SecurityPolicyViolationEvent',
    'Selection','ServiceWorker','ServiceWorkerContainer',
    'ServiceWorkerRegistration','ShadowRoot','SourceBuffer','SourceBufferList',
    'StaticRange','Storage','StorageEvent','StyleSheet','StyleSheetList',
    'SubmitEvent','Text','TextDecoder','TextEncoder','TextEvent','TextMetrics',
    'TextTrack','TextTrackCue','TextTrackCueList','TextTrackList',
    'TimeRanges','Touch','TouchEvent','TouchList','TrackEvent',
    'TransformStream','TransformStreamDefaultController','TransitionEvent',
    'TreeWalker','UIEvent','URL','URLSearchParams','VTTCue','ValidityState',
    'VisualViewport','WaveShaperNode','WebGL2RenderingContext',
    'WebGLActiveInfo','WebGLBuffer','WebGLContextEvent','WebGLFramebuffer',
    'WebGLProgram','WebGLQuery','WebGLRenderbuffer','WebGLRenderingContext',
    'WebGLSampler','WebGLShader','WebGLShaderPrecisionFormat','WebGLSync',
    'WebGLTexture','WebGLTransformFeedback','WebGLUniformLocation',
    'WebGLVertexArrayObject','WebSocket','WheelEvent','Window','Worker',
    'WritableStream','WritableStreamDefaultController',
    'WritableStreamDefaultWriter','XMLDocument','XMLHttpRequest',
    'XMLHttpRequestEventTarget','XMLHttpRequestUpload','XMLSerializer',
    'XPathEvaluator','XPathExpression','XPathResult','XSLTProcessor',
    'Audio','Atomics','Math','Reflect','console','WebAssembly',
    'FontFaceSetLoadEvent','MediaCapabilities','Scheduler','Sanitizer',
    'TrustedHTML','TrustedScript','TrustedScriptURL','TrustedTypePolicy',
    'TrustedTypePolicyFactory','DocumentTimeline','AnimationTimeline',
    'Animation','AnimationEffect','AnimationEvent','AnimationPlaybackEvent',
    'KeyframeEffect','ComputedEffectTiming','EffectTiming',
    'getComputedStyle','matchMedia',
    '__REACT_DEVTOOLS_GLOBAL_HOOK__','__VUE_DEVTOOLS_GLOBAL_HOOK__',
  ]);

  const results = [];
  const keys = Object.keys(window);
  for (const key of keys) {
    if (BROWSER_BUILTINS.has(key)) continue;
    if (key.startsWith('__zone') || (key.startsWith('_') && !key.startsWith('__'))) continue;
    try {
      const val = window[key];
      const type = typeof val;
      let topLevelKeys;
      if (type === 'object' && val !== null && !Array.isArray(val)) {
        try {
          topLevelKeys = Object.keys(val).slice(0, 20);
        } catch {}
      }
      results.push({ path: key, type, topLevelKeys });
    } catch {}
  }
  return results;
`;

/**
 * Returns JS code that collects form data from the page.
 */
const FORMS_SCRIPT = `
  const forms = [];
  for (const form of document.querySelectorAll('form')) {
    const fields = [];
    for (const el of form.querySelectorAll('input, select, textarea')) {
      const name = el.getAttribute('name') || '';
      const type = el.getAttribute('type') || el.tagName.toLowerCase();
      if (name) fields.push({ name, type });
    }
    forms.push({
      action: form.getAttribute('action') || '',
      method: (form.getAttribute('method') || 'GET').toUpperCase(),
      fields,
    });
  }
  return forms;
`;

/**
 * Returns JS code that collects interactive elements from the page.
 */
const INTERACTIVE_ELEMENTS_SCRIPT = `
  const elements = [];
  const selectors = 'button, [onclick], a[href^="javascript:"], input, select, textarea, [role="button"]';
  const limit = 100;
  let count = 0;
  for (const el of document.querySelectorAll(selectors)) {
    if (count >= limit) break;
    elements.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || undefined,
      name: el.getAttribute('name') || undefined,
      id: el.id || undefined,
      text: (el.textContent || '').trim().slice(0, 100) || undefined,
    });
    count++;
  }
  return elements;
`;

/**
 * Returns JS code that collects unique data-* attribute names from the page.
 */
const DATA_ATTRIBUTES_SCRIPT = `
  const attrs = new Set();
  for (const el of document.querySelectorAll('*')) {
    if (el.dataset) {
      for (const key of Object.keys(el.dataset)) {
        attrs.add(key);
      }
    }
    if (attrs.size > 200) break;
  }
  return Array.from(attrs);
`;

/**
 * Returns JS code that collects storage key names.
 */
const STORAGE_KEYS_SCRIPT = `
  const cookieNames = [];
  try {
    const cookieStr = document.cookie;
    if (cookieStr) {
      for (const pair of cookieStr.split(';')) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) {
          cookieNames.push(pair.slice(0, eqIdx).trim());
        }
      }
    }
  } catch {}

  let localStorageKeys = [];
  try { localStorageKeys = Object.keys(localStorage); } catch {}

  let sessionStorageKeys = [];
  try { sessionStorageKeys = Object.keys(sessionStorage); } catch {}

  return { cookieNames, localStorageKeys, sessionStorageKeys };
`;

/**
 * Returns JS code that reads localStorage/sessionStorage entries (keys + values)
 * for auth detection (JWT detection needs values).
 */
const STORAGE_ENTRIES_SCRIPT = `
  const localEntries = [];
  try {
    for (const key of Object.keys(localStorage)) {
      try {
        const val = localStorage.getItem(key);
        if (val !== null) localEntries.push({ key, value: val });
      } catch {}
    }
  } catch {}

  const sessionEntries = [];
  try {
    for (const key of Object.keys(sessionStorage)) {
      try {
        const val = sessionStorage.getItem(key);
        if (val !== null) sessionEntries.push({ key, value: val });
      } catch {}
    }
  } catch {}

  return { localEntries, sessionEntries };
`;

// ---------------------------------------------------------------------------
// Suggestion generation
// ---------------------------------------------------------------------------

/**
 * Generate tool suggestions from the analysis results.
 * Produces actionable suggestions for plugin developers based on detected
 * APIs, forms, and capabilities.
 */
const generateSuggestions = (
  apis: ApiAnalysis,
  dom: DomAnalysis,
  auth: AuthAnalysis,
  _framework: FrameworkAnalysis,
): ToolSuggestion[] => {
  const suggestions: ToolSuggestion[] = [];

  // REST API suggestions
  for (const endpoint of apis.endpoints) {
    if (endpoint.protocol === 'rest') {
      const suggestion = restEndpointSuggestion(endpoint);
      if (suggestion) suggestions.push(suggestion);
    }
  }

  // GraphQL suggestions
  const graphqlEndpoints = apis.endpoints.filter(e => e.protocol === 'graphql');
  if (graphqlEndpoints.length > 0) {
    suggestions.push({
      toolName: 'graphql_query',
      description: 'Execute GraphQL queries against the site API',
      approach: `Send POST requests to ${graphqlEndpoints[0]?.url ?? '/graphql'} with { query, variables } body. Use fetchJSON from the plugin SDK with the site's auth headers.`,
      complexity: 'medium',
    });

    // Suggest tools based on observed query body samples
    for (const ep of graphqlEndpoints) {
      if (ep.requestBodySample) {
        const queryTools = graphqlQuerySuggestions(ep);
        suggestions.push(...queryTools);
      }
    }
  }

  // JSON-RPC suggestions
  const jsonrpcEndpoints = apis.endpoints.filter(e => e.protocol === 'jsonrpc');
  if (jsonrpcEndpoints.length > 0) {
    suggestions.push({
      toolName: 'rpc_call',
      description: 'Execute JSON-RPC calls against the site API',
      approach: `Send POST requests to ${jsonrpcEndpoints[0]?.url ?? '/rpc'} with { jsonrpc: "2.0", method, params, id } body.`,
      complexity: 'medium',
    });
  }

  // tRPC suggestions
  const trpcEndpoints = apis.endpoints.filter(e => e.protocol === 'trpc');
  if (trpcEndpoints.length > 0) {
    for (const ep of trpcEndpoints) {
      const procedureName = extractTrpcProcedure(ep.url);
      if (procedureName) {
        suggestions.push({
          toolName: `trpc_${procedureName.replace(/\./g, '_')}`,
          description: `Call tRPC procedure ${procedureName}`,
          approach: `${ep.method} ${ep.url}${ep.method === 'POST' ? ' with JSON body' : ' with query params'}. Auth: ${auth.authenticated ? 'include session credentials' : 'none detected'}.`,
          complexity: 'low',
        });
      }
    }
  }

  // WebSocket suggestions
  const wsEndpoints = apis.endpoints.filter(e => e.protocol === 'websocket');
  if (wsEndpoints.length > 0) {
    suggestions.push({
      toolName: 'subscribe_realtime',
      description: 'Subscribe to real-time WebSocket updates',
      approach: `Connect to ${wsEndpoints[0]?.url ?? 'the WebSocket endpoint'}. Monitor incoming messages for real-time data updates.`,
      complexity: 'high',
    });
  }

  // Form suggestions
  for (const form of dom.forms) {
    if (form.fields.length > 0) {
      const formName = deriveFormName(form);
      suggestions.push({
        toolName: `submit_${formName}`,
        description: `Submit the ${formName} form`,
        approach: `POST to ${form.action || 'current page'} with fields: ${form.fields.map(f => f.name).join(', ')}. ${auth.methods.some(m => m.type === 'csrf-token') ? 'Include CSRF token from meta tag or hidden input.' : ''}`,
        complexity: 'low',
      });
    }
  }

  return suggestions;
};

/** Generate a suggestion for a REST endpoint. */
const restEndpointSuggestion = (endpoint: ApiEndpoint): ToolSuggestion | undefined => {
  const urlPath = extractPathSegments(endpoint.url);
  if (!urlPath) return undefined;

  const resourceName = extractResourceName(urlPath);
  if (!resourceName) return undefined;

  const verb = httpMethodToVerb(endpoint.method);
  const toolName = `${verb}_${resourceName}`;

  return {
    toolName,
    description: `${capitalizeFirst(verb)} ${resourceName} via ${endpoint.method} ${urlPath}`,
    approach: `${endpoint.method} ${endpoint.url}${endpoint.requestBodySample ? ` with JSON body (sample: ${endpoint.requestBodySample.slice(0, 100)})` : ''}. ${endpoint.authHeader ? `Include ${endpoint.authHeader} header.` : 'No auth header detected.'}`,
    complexity: endpoint.method === 'GET' ? 'low' : 'medium',
  };
};

/** Extract GraphQL query/mutation names from a request body sample. */
const graphqlQuerySuggestions = (endpoint: ApiEndpoint): ToolSuggestion[] => {
  if (!endpoint.requestBodySample) return [];
  try {
    const body = JSON.parse(endpoint.requestBodySample) as Record<string, unknown>;
    const query = body.query;
    if (typeof query !== 'string') return [];

    // Extract operation name: query OperationName { or mutation OperationName {
    const match = /(?:query|mutation)\s+(\w+)/.exec(query);
    if (match?.[1]) {
      const opName = match[1];
      const isMutation = match[0].startsWith('mutation');
      return [
        {
          toolName: `gql_${toSnakeCase(opName)}`,
          description: `${isMutation ? 'Execute' : 'Query'} ${opName}`,
          approach: `POST to ${endpoint.url} with query: "${query.slice(0, 100)}..."`,
          complexity: 'medium',
        },
      ];
    }
  } catch {
    // Invalid JSON
  }
  return [];
};

/** Extract tRPC procedure name from URL. */
const extractTrpcProcedure = (url: string): string | undefined => {
  try {
    const pathname = new URL(url).pathname;
    const match = /\/(?:api\/)?trpc\/(.+)$/.exec(pathname);
    return match?.[1];
  } catch {
    return undefined;
  }
};

/** Derive a form name from its fields or action URL. */
const deriveFormName = (form: { action: string; fields: Array<{ name: string }> }): string => {
  // Try the action URL
  if (form.action) {
    try {
      const pathname = new URL(form.action, 'http://dummy').pathname;
      const lastSegment = pathname.split('/').filter(Boolean).pop();
      if (lastSegment) return toSnakeCase(lastSegment);
    } catch {
      // Not a valid URL
    }
  }

  // Fall back to field-based name
  const hasPassword = form.fields.some(f => f.name.toLowerCase().includes('password'));
  const hasEmail = form.fields.some(f => f.name.toLowerCase().includes('email'));
  if (hasPassword && hasEmail) return 'login';
  if (hasPassword) return 'auth';
  if (form.fields.some(f => f.name.toLowerCase().includes('search') || f.name.toLowerCase().includes('query')))
    return 'search';

  return 'form';
};

/** Extract the URL path from a full URL. */
const extractPathSegments = (url: string): string | undefined => {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
};

/** Extract a resource name from a URL path (e.g., /api/items → items). */
const extractResourceName = (path: string): string | undefined => {
  const segments = path.split('/').filter(Boolean);
  // Find the last non-version, non-api segment
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment) continue;
    if (/^(api|v\d+|graphql|trpc|rpc)$/i.test(segment)) continue;
    // Skip segments that look like IDs (all digits or UUIDs)
    if (/^\d+$/.test(segment) || /^[0-9a-f-]{36}$/i.test(segment)) continue;
    return toSnakeCase(segment);
  }
  return undefined;
};

/** Convert an HTTP method to a verb for tool naming. */
const httpMethodToVerb = (method: string): string => {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'list';
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return method.toLowerCase();
  }
};

/** Convert a string to snake_case. */
const toSnakeCase = (str: string): string =>
  str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();

/** Capitalize the first letter of a string. */
const capitalizeFirst = (str: string): string => {
  if (str.length === 0) return str;
  const first = str[0];
  if (!first) return str;
  return first.toUpperCase() + str.slice(1);
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/** Default wait time (seconds) for network activity after page load. */
const DEFAULT_WAIT_SECONDS = 5;

/**
 * Orchestrate a comprehensive site analysis.
 *
 * Flow:
 * 1. Open tab to about:blank
 * 2. Enable network capture (before any real page requests fire)
 * 3. Navigate to target URL (CDP debugger is attached; captures all requests from load start)
 * 4. Wait for API calls (configurable wait time)
 * 5. Run detection scripts in page context (parallel where possible)
 * 6. Get captured network requests
 * 7. Pass collected data through detection modules
 * 8. Generate tool suggestions
 * 9. Return structured result
 */
const analyzeSite = async (
  state: ServerState,
  url: string,
  waitSeconds: number = DEFAULT_WAIT_SECONDS,
): Promise<SiteAnalysis> => {
  let tabId: number | null = null;
  let cancelSleep: (() => void) | undefined;
  let captureConn: ExtensionConnection | undefined;

  try {
    // Step 1: Open a new tab to about:blank so network capture can be enabled
    // before any target-URL requests fire
    const openResult = await dispatchToExtension(state, 'browser.openTab', { url: 'about:blank' });
    if (
      typeof openResult !== 'object' ||
      openResult === null ||
      typeof (openResult as Record<string, unknown>).id !== 'number'
    ) {
      throw new Error(
        `browser.openTab returned invalid result: expected { id: number }, got ${JSON.stringify(openResult)}`,
      );
    }
    tabId = (openResult as { id: number }).id;

    // Step 2: Enable network capture before navigating to the target URL so
    // early page-load requests (auth token exchanges, initial data fetches) are captured
    await dispatchToExtension(state, 'browser.enableNetworkCapture', {
      tabId,
      maxRequests: 200,
    });
    captureConn = getConnectionForTab(state, tabId) ?? getAnyConnection(state);
    captureConn?.activeNetworkCaptures.add(tabId);

    // Step 3: Navigate to the target URL — network capture is already active
    await dispatchToExtension(state, 'browser.navigateTab', { tabId, url });

    // Step 4: Wait for page load and API calls (cancellable so the finally
    // block can clean up immediately when the outer dispatch times out)
    const sleepPromise = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, waitSeconds * 1_000);
      cancelSleep = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    await sleepPromise;

    // Step 5: Run detection scripts in the page context sequentially.
    // Sequential execution avoids the extension's per-method rate limit
    // (max 10 browser.executeScript calls per second) and is reliable
    // since each script completes quickly (~5-50ms in page context).
    // Each call is individually wrapped in try-catch so one failure
    // returns partial results rather than crashing the entire analysis.

    let csrfTokens: CsrfDomToken[] = [];
    try {
      const rawCsrf = await executeInTab(state, tabId, CSRF_SCRIPT);
      csrfTokens = Array.isArray(rawCsrf) ? (rawCsrf as CsrfDomToken[]) : [];
    } catch {
      // Partial analysis: CSRF detection skipped
    }

    let globalsAuth: GlobalEntry[] = [];
    try {
      const rawGlobalsAuth = await executeInTab(state, tabId, GLOBALS_AUTH_SCRIPT);
      globalsAuth = Array.isArray(rawGlobalsAuth) ? (rawGlobalsAuth as GlobalEntry[]) : [];
    } catch {
      // Partial analysis: globals auth detection skipped
    }

    let frameworkProbes: FrameworkProbe[] = [];
    try {
      const rawFramework = await executeInTab(state, tabId, FRAMEWORK_PROBE_SCRIPT);
      frameworkProbes = deduplicateFrameworkProbes(
        Array.isArray(rawFramework) ? (rawFramework as FrameworkProbe[]) : [],
      );
    } catch {
      // Partial analysis: framework detection skipped
    }

    const defaultSpaSsrProbe = {
      hasSingleRootElement: false,
      usesPushState: false,
      hasNextData: false,
      hasNuxtData: false,
      hasHydrationMarkers: false,
    };
    let spaSsrProbe = defaultSpaSsrProbe;
    try {
      const rawProbe = await executeInTab(state, tabId, SPA_SSR_PROBE_SCRIPT);
      if (rawProbe !== null && typeof rawProbe === 'object' && !Array.isArray(rawProbe)) {
        const obj = rawProbe as Record<string, unknown>;
        spaSsrProbe = {
          hasSingleRootElement: obj.hasSingleRootElement === true,
          usesPushState: obj.usesPushState === true,
          hasNextData: obj.hasNextData === true,
          hasNuxtData: obj.hasNuxtData === true,
          hasHydrationMarkers: obj.hasHydrationMarkers === true,
        };
      }
    } catch {
      // Partial analysis: SPA/SSR detection skipped
    }

    let globalsScan: GlobalProperty[] = [];
    try {
      const rawGlobalsScan = await executeInTab(state, tabId, GLOBALS_SCAN_SCRIPT);
      globalsScan = Array.isArray(rawGlobalsScan) ? (rawGlobalsScan as GlobalProperty[]) : [];
    } catch {
      // Partial analysis: globals scan skipped
    }

    let forms: FormInput[] = [];
    try {
      const rawForms = await executeInTab(state, tabId, FORMS_SCRIPT);
      forms = Array.isArray(rawForms) ? (rawForms as FormInput[]) : [];
    } catch {
      // Partial analysis: forms detection skipped
    }

    let interactiveElements: InteractiveElementInput[] = [];
    try {
      const rawInteractive = await executeInTab(state, tabId, INTERACTIVE_ELEMENTS_SCRIPT);
      interactiveElements = Array.isArray(rawInteractive) ? (rawInteractive as InteractiveElementInput[]) : [];
    } catch {
      // Partial analysis: interactive elements detection skipped
    }

    let dataAttributes: string[] = [];
    try {
      const rawDataAttributes = await executeInTab(state, tabId, DATA_ATTRIBUTES_SCRIPT);
      dataAttributes = Array.isArray(rawDataAttributes) ? (rawDataAttributes as string[]) : [];
    } catch {
      // Partial analysis: data attributes detection skipped
    }

    const defaultStorageKeys = {
      cookieNames: [] as string[],
      localStorageKeys: [] as string[],
      sessionStorageKeys: [] as string[],
    };
    let storageKeys = defaultStorageKeys;
    try {
      const rawStorageKeys = await executeInTab(state, tabId, STORAGE_KEYS_SCRIPT);
      if (rawStorageKeys !== null && typeof rawStorageKeys === 'object' && !Array.isArray(rawStorageKeys)) {
        const obj = rawStorageKeys as Record<string, unknown>;
        storageKeys = {
          cookieNames: Array.isArray(obj.cookieNames) ? (obj.cookieNames as string[]) : [],
          localStorageKeys: Array.isArray(obj.localStorageKeys) ? (obj.localStorageKeys as string[]) : [],
          sessionStorageKeys: Array.isArray(obj.sessionStorageKeys) ? (obj.sessionStorageKeys as string[]) : [],
        };
      }
    } catch {
      // Partial analysis: storage keys detection skipped
    }

    const defaultStorageEntries = {
      localEntries: [] as StorageEntry[],
      sessionEntries: [] as StorageEntry[],
    };
    let storageEntries = defaultStorageEntries;
    try {
      const rawStorageEntries = await executeInTab(state, tabId, STORAGE_ENTRIES_SCRIPT);
      if (rawStorageEntries !== null && typeof rawStorageEntries === 'object' && !Array.isArray(rawStorageEntries)) {
        const obj = rawStorageEntries as Record<string, unknown>;
        storageEntries = {
          localEntries: Array.isArray(obj.localEntries) ? (obj.localEntries as StorageEntry[]) : [],
          sessionEntries: Array.isArray(obj.sessionEntries) ? (obj.sessionEntries as StorageEntry[]) : [],
        };
      }
    } catch {
      // Partial analysis: storage entries detection skipped
    }

    let pageTitle = '';
    try {
      pageTitle = ((await executeInTab(state, tabId, 'return document.title')) as string | null) ?? '';
    } catch {
      // Partial analysis: page title detection skipped
    }

    // Step 6: Get captured network requests
    let networkRequests: NetworkRequest[] = [];
    try {
      const networkResult = await dispatchToExtension(state, 'browser.getNetworkRequests', {
        tabId,
        clear: true,
      });
      networkRequests = validateDispatchResult<NetworkRequest>(networkResult, 'requests', 'browser.getNetworkRequests');
    } catch {
      // Partial analysis: network requests unavailable — finally block handles cleanup
    }

    // Get captured WebSocket frames
    let wsFrames: WsFrame[] = [];
    try {
      const wsResult = await dispatchToExtension(state, 'browser.getWebSocketFrames', {
        tabId,
        clear: true,
      });
      wsFrames = validateDispatchResult<WsFrame>(wsResult, 'frames', 'browser.getWebSocketFrames');
    } catch {
      // Partial analysis: WebSocket frames unavailable
    }

    // Get cookies via extension API (includes HttpOnly cookies)
    let cookies: CookieEntry[] = [];
    try {
      const cookieResult = await dispatchToExtension(state, 'browser.getCookies', { url });
      cookies = validateDispatchResult<CookieEntry>(cookieResult, 'cookies', 'browser.getCookies');
    } catch {
      // Partial analysis: cookie data unavailable
    }

    // Step 7: Run detection modules
    const auth = detectAuth({
      cookies,
      localStorageEntries: storageEntries.localEntries,
      sessionStorageEntries: storageEntries.sessionEntries,
      networkRequests,
      csrfDomTokens: csrfTokens,
      windowGlobals: globalsAuth,
    });

    const apis = detectApis(networkRequests, wsFrames);

    const frameworkAnalysis = detectFramework({
      frameworkProbes,
      hasSingleRootElement: spaSsrProbe.hasSingleRootElement,
      usesPushState: spaSsrProbe.usesPushState,
      hasNextData: spaSsrProbe.hasNextData,
      hasNuxtData: spaSsrProbe.hasNuxtData,
      hasHydrationMarkers: spaSsrProbe.hasHydrationMarkers,
    });

    const globals = detectGlobals({ globals: globalsScan });

    const domAnalysis = detectDom({
      forms,
      interactiveElements,
      dataAttributes,
    });

    const storage = detectStorage(storageKeys);

    // Step 8: Generate suggestions
    const suggestions = generateSuggestions(apis, domAnalysis, auth, frameworkAnalysis);

    return {
      url,
      title: pageTitle,
      auth,
      apis,
      framework: frameworkAnalysis,
      globals,
      dom: domAnalysis,
      storage,
      suggestions,
    };
  } finally {
    // Cancel the observation sleep immediately so cleanup proceeds without delay
    // when the outer MCP dispatch times out
    cancelSleep?.();

    // Clean up: disable network capture then close the tab (only if a tab was successfully opened)
    if (tabId !== null) {
      try {
        await dispatchToExtension(state, 'browser.disableNetworkCapture', { tabId });
      } catch {
        // Best-effort cleanup — ignore errors
      }
      captureConn?.activeNetworkCaptures.delete(tabId);
      try {
        await dispatchToExtension(state, 'browser.closeTab', { tabId });
      } catch {
        // Best-effort cleanup — ignore errors
      }
    }
  }
};

export type { SiteAnalysis, ToolSuggestion };
export {
  analyzeSite,
  capitalizeFirst,
  deriveFormName,
  extractPathSegments,
  extractResourceName,
  extractTrpcProcedure,
  generateSuggestions,
  graphqlQuerySuggestions,
  httpMethodToVerb,
  restEndpointSuggestion,
  toSnakeCase,
};
