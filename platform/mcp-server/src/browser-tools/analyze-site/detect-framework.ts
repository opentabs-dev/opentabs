/**
 * Framework and rendering detection module for the site analyzer.
 *
 * Pure analysis function: takes the result of executing detection scripts
 * in the page context and returns structured framework information.
 * Does not call browser tools directly — the orchestrator collects data
 * and passes it here.
 */

// ---------------------------------------------------------------------------
// Input types — match data shapes the orchestrator collects via page scripts
// ---------------------------------------------------------------------------

/** A detected framework from page-context probing. */
interface FrameworkProbe {
  name: string;
  version: string | undefined;
}

/** Data collected by the orchestrator and passed to detectFramework. */
interface FrameworkDetectionInput {
  /** Frameworks found by probing globals and DOM markers. */
  frameworkProbes: FrameworkProbe[];
  /** Whether the page has a single root element (e.g., div#root, div#app, div#__next). */
  hasSingleRootElement: boolean;
  /** Whether the page has evidence of pushState/replaceState routing. */
  usesPushState: boolean;
  /** Whether window.__NEXT_DATA__ exists. */
  hasNextData: boolean;
  /** Whether window.__NUXT__ exists. */
  hasNuxtData: boolean;
  /** Whether the page contains hydration markers (e.g., data-reactroot, data-server-rendered). */
  hasHydrationMarkers: boolean;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** A detected frontend framework with its name and optional version. */
interface FrameworkInfo {
  name: string;
  version: string | undefined;
}

/** Result of framework detection: identified frameworks plus SPA and SSR classification. */
interface FrameworkAnalysis {
  frameworks: FrameworkInfo[];
  isSPA: boolean;
  isSSR: boolean;
}

// ---------------------------------------------------------------------------
// Detection logic
// ---------------------------------------------------------------------------

/**
 * Deduplicate framework probes by name, preferring entries with a version over
 * versionless entries for the same framework name.
 *
 * Vue detection pushes a versionless entry first (window.__VUE__) and a versioned
 * entry second (window.__VUE_DEVTOOLS_GLOBAL_HOOK__.Vue.version). Without this,
 * the first (versionless) entry wins and the version is lost.
 */
const deduplicateFrameworkProbes = (probes: FrameworkProbe[]): FrameworkProbe[] => {
  const best = new Map<string, FrameworkProbe>();
  for (const p of probes) {
    const existing = best.get(p.name);
    if (!existing || (!existing.version && p.version !== undefined)) {
      best.set(p.name, p);
    }
  }
  return Array.from(best.values());
};

/**
 * Analyze collected framework probe data and determine SPA/SSR status.
 *
 * This is a pure function: takes data in, returns structured results.
 */
const detectFramework = (input: FrameworkDetectionInput): FrameworkAnalysis => {
  const frameworks: FrameworkInfo[] = input.frameworkProbes.map(probe => ({
    name: probe.name,
    version: probe.version,
  }));

  // SPA detection: single root element + pushState routing, or known SPA frameworks
  const knownSpaFrameworks = new Set(['react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt', 'ember']);
  const hasKnownSpa = frameworks.some(f => knownSpaFrameworks.has(f.name));
  const isSPA = (input.hasSingleRootElement && input.usesPushState) || hasKnownSpa;

  // SSR detection: __NEXT_DATA__, __NUXT__, or hydration markers
  const isSSR = input.hasNextData || input.hasNuxtData || input.hasHydrationMarkers;

  return { frameworks, isSPA, isSSR };
};

export { deduplicateFrameworkProbes, detectFramework };
export type { FrameworkDetectionInput, FrameworkProbe, FrameworkAnalysis, FrameworkInfo };
