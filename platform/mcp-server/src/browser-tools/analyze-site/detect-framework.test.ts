import { deduplicateFrameworkProbes, detectFramework } from './detect-framework.js';
import { describe, expect, test } from 'vitest';
import type { FrameworkDetectionInput } from './detect-framework.js';

const emptyInput: FrameworkDetectionInput = {
  frameworkProbes: [],
  hasSingleRootElement: false,
  usesPushState: false,
  hasNextData: false,
  hasNuxtData: false,
  hasHydrationMarkers: false,
};

// ---------------------------------------------------------------------------
// deduplicateFrameworkProbes
// ---------------------------------------------------------------------------

describe('deduplicateFrameworkProbes', () => {
  test('prefers versioned entry over versionless entry for same name', () => {
    const result = deduplicateFrameworkProbes([
      { name: 'vue', version: undefined },
      { name: 'vue', version: '3.4.1' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('vue');
    expect(result[0]?.version).toBe('3.4.1');
  });

  test('deduplicates true duplicates (same name, same version)', () => {
    const result = deduplicateFrameworkProbes([
      { name: 'react', version: '18.2.0' },
      { name: 'react', version: '18.2.0' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.version).toBe('18.2.0');
  });

  test('keeps distinct framework names', () => {
    const result = deduplicateFrameworkProbes([
      { name: 'react', version: '18.2.0' },
      { name: 'vue', version: '3.4.1' },
    ]);
    expect(result).toHaveLength(2);
  });

  test('keeps versionless entry when no versioned entry exists for the same name', () => {
    const result = deduplicateFrameworkProbes([{ name: 'svelte', version: undefined }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.version).toBeUndefined();
  });

  test('returns empty array for empty input', () => {
    expect(deduplicateFrameworkProbes([])).toEqual([]);
  });
});

describe('detectFramework', () => {
  test('returns empty when no frameworks detected', () => {
    const result = detectFramework(emptyInput);
    expect(result.frameworks).toEqual([]);
    expect(result.isSPA).toBe(false);
    expect(result.isSSR).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Framework detection
  // -----------------------------------------------------------------------

  describe('framework detection', () => {
    test('detects React with version', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'react', version: '18.2.0' }],
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0]?.name).toBe('react');
      expect(result.frameworks[0]?.version).toBe('18.2.0');
    });

    test('detects Next.js', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'nextjs', version: '14.1.0' }],
        hasNextData: true,
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0]?.name).toBe('nextjs');
      expect(result.frameworks[0]?.version).toBe('14.1.0');
    });

    test('detects Vue with version', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'vue', version: '3.4.21' }],
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0]?.name).toBe('vue');
      expect(result.frameworks[0]?.version).toBe('3.4.21');
    });

    test('detects Nuxt', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'nuxt', version: undefined }],
        hasNuxtData: true,
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0]?.name).toBe('nuxt');
      expect(result.frameworks[0]?.version).toBeUndefined();
    });

    test('detects Angular with version', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'angular', version: '17.2.0' }],
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0]?.name).toBe('angular');
    });

    test('detects Svelte', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'svelte', version: '4.2.0' }],
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0]?.name).toBe('svelte');
    });

    test('detects jQuery', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'jquery', version: '3.7.1' }],
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0]?.name).toBe('jquery');
    });

    test('detects Ember', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'ember', version: '5.4.0' }],
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0]?.name).toBe('ember');
    });

    test('detects Backbone', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'backbone', version: '1.6.0' }],
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0]?.name).toBe('backbone');
    });

    test('detects multiple frameworks', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [
          { name: 'react', version: '18.2.0' },
          { name: 'jquery', version: '3.7.1' },
        ],
      });
      expect(result.frameworks).toHaveLength(2);
      expect(result.frameworks.map(f => f.name)).toEqual(['react', 'jquery']);
    });

    test('handles framework with undefined version', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'react', version: undefined }],
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.frameworks[0]?.version).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // SPA detection
  // -----------------------------------------------------------------------

  describe('SPA detection', () => {
    test('detects SPA from single root element and pushState', () => {
      const result = detectFramework({
        ...emptyInput,
        hasSingleRootElement: true,
        usesPushState: true,
      });
      expect(result.isSPA).toBe(true);
    });

    test('not SPA with single root element but no pushState', () => {
      const result = detectFramework({
        ...emptyInput,
        hasSingleRootElement: true,
        usesPushState: false,
      });
      expect(result.isSPA).toBe(false);
    });

    test('not SPA with pushState but no single root element', () => {
      const result = detectFramework({
        ...emptyInput,
        hasSingleRootElement: false,
        usesPushState: true,
      });
      expect(result.isSPA).toBe(false);
    });

    test('detects SPA from known SPA framework (React)', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'react', version: '18.2.0' }],
      });
      expect(result.isSPA).toBe(true);
    });

    test('detects SPA from known SPA framework (Vue)', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'vue', version: '3.4.0' }],
      });
      expect(result.isSPA).toBe(true);
    });

    test('detects SPA from known SPA framework (Angular)', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'angular', version: '17.0.0' }],
      });
      expect(result.isSPA).toBe(true);
    });

    test('detects SPA from known SPA framework (Svelte)', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'svelte', version: '4.2.0' }],
      });
      expect(result.isSPA).toBe(true);
    });

    test('jQuery alone does not trigger SPA', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'jquery', version: '3.7.1' }],
      });
      expect(result.isSPA).toBe(false);
    });

    test('Backbone alone does not trigger SPA', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'backbone', version: '1.6.0' }],
      });
      expect(result.isSPA).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // SSR detection
  // -----------------------------------------------------------------------

  describe('SSR detection', () => {
    test('detects SSR from __NEXT_DATA__', () => {
      const result = detectFramework({
        ...emptyInput,
        hasNextData: true,
      });
      expect(result.isSSR).toBe(true);
    });

    test('detects SSR from __NUXT__', () => {
      const result = detectFramework({
        ...emptyInput,
        hasNuxtData: true,
      });
      expect(result.isSSR).toBe(true);
    });

    test('detects SSR from hydration markers', () => {
      const result = detectFramework({
        ...emptyInput,
        hasHydrationMarkers: true,
      });
      expect(result.isSSR).toBe(true);
    });

    test('not SSR when no SSR signals present', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'react', version: '18.2.0' }],
      });
      expect(result.isSSR).toBe(false);
    });

    test('SSR and SPA can both be true (Next.js-style)', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'nextjs', version: '14.1.0' }],
        hasNextData: true,
        hasSingleRootElement: true,
        usesPushState: true,
      });
      expect(result.isSPA).toBe(true);
      expect(result.isSSR).toBe(true);
    });

    test('SSR and SPA can both be true (Nuxt-style)', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'nuxt', version: '3.10.0' }],
        hasNuxtData: true,
      });
      expect(result.isSPA).toBe(true);
      expect(result.isSSR).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Combined scenarios
  // -----------------------------------------------------------------------

  describe('combined scenarios', () => {
    test('React SPA with no SSR', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'react', version: '18.2.0' }],
        hasSingleRootElement: true,
        usesPushState: true,
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.isSPA).toBe(true);
      expect(result.isSSR).toBe(false);
    });

    test('Next.js full-stack (React + SSR + SPA)', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [
          { name: 'nextjs', version: '14.1.0' },
          { name: 'react', version: '18.2.0' },
        ],
        hasNextData: true,
        hasSingleRootElement: true,
        usesPushState: true,
        hasHydrationMarkers: true,
      });
      expect(result.frameworks).toHaveLength(2);
      expect(result.isSPA).toBe(true);
      expect(result.isSSR).toBe(true);
    });

    test('static MPA (jQuery, no SPA/SSR)', () => {
      const result = detectFramework({
        ...emptyInput,
        frameworkProbes: [{ name: 'jquery', version: '3.7.1' }],
      });
      expect(result.frameworks).toHaveLength(1);
      expect(result.isSPA).toBe(false);
      expect(result.isSSR).toBe(false);
    });

    test('empty page (no frameworks, no SPA, no SSR)', () => {
      const result = detectFramework(emptyInput);
      expect(result.frameworks).toEqual([]);
      expect(result.isSPA).toBe(false);
      expect(result.isSSR).toBe(false);
    });
  });
});
