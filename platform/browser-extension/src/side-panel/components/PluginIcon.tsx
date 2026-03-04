import type { TabState } from '@opentabs-dev/shared';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { sanitizeSvg } from '../../sanitize-svg.js';
import { cn } from '../lib/cn.js';

/**
 * Subscribes to dark mode class changes on <html> via MutationObserver.
 * Returns true when the 'dark' class is present on document.documentElement.
 */
const darkModeListeners = new Set<() => void>();
let darkModeObserver: MutationObserver | null = null;

const subscribeDarkMode = (callback: () => void): (() => void) => {
  darkModeListeners.add(callback);
  if (!darkModeObserver) {
    darkModeObserver = new MutationObserver(() => {
      for (const listener of darkModeListeners) listener();
    });
    darkModeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
  return () => {
    darkModeListeners.delete(callback);
    if (darkModeListeners.size === 0 && darkModeObserver) {
      darkModeObserver.disconnect();
      darkModeObserver = null;
    }
  };
};

const getIsDark = (): boolean => document.documentElement.classList.contains('dark');

const useIsDark = (): boolean => useSyncExternalStore(subscribeDarkMode, getIsDark);

const AVATAR_PALETTE_SIZE = 10;

/** djb2 string hash to unsigned 32-bit integer. */
const hashString = (str: string): number => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
};

/** Returns a CSS variable reference for the deterministic avatar color. */
const getAvatarVar = (pluginName: string): string =>
  `var(--avatar-${String(hashString(pluginName) % AVATAR_PALETTE_SIZE)})`;

/** Extracts the display letter from the plugin's displayName, falling back to name. */
const getAvatarLetter = (displayName: string, pluginName: string): string =>
  (displayName[0] ?? pluginName[0] ?? '?').toUpperCase();

interface PluginIconProps {
  pluginName: string;
  displayName: string;
  tabState?: TabState;
  size?: number;
  className?: string;
  iconSvg?: string;
  iconInactiveSvg?: string;
  iconDarkSvg?: string;
  iconDarkInactiveSvg?: string;
  active?: boolean;
}

/**
 * Sanitizes rawSvg for rendering, returning undefined and logging a warning if sanitizeSvg throws.
 * Exported for unit testing.
 */
const tryGetSanitizedSvg = (rawSvg: string | undefined, pluginName: string): string | undefined => {
  if (!rawSvg) return undefined;
  try {
    return sanitizeSvg(rawSvg);
  } catch (err) {
    console.warn(`[opentabs] sanitizeSvg failed for plugin "${pluginName}":`, err);
    return undefined;
  }
};

/**
 * Returns border classes for the icon container based on tab state and activity.
 * Ready + idle: solid border. Ready + active: pulsing yellow border. Ready + fading out: fading border.
 * Not ready (unavailable/closed): faded ghost border.
 */
const getBorderClasses = (tabState: TabState, active: boolean, fadingOut: boolean): string => {
  if (tabState !== 'ready') return 'border-2 border-border/30';
  if (active) return 'border-2 animate-activity-border-flash';
  if (fadingOut) return 'border-2 animate-activity-border-fade-out';
  return 'border-2 border-border';
};

const PluginIcon = ({
  pluginName,
  displayName,
  tabState = 'closed',
  size = 32,
  className = '',
  iconSvg,
  iconInactiveSvg,
  iconDarkSvg,
  iconDarkInactiveSvg,
  active = false,
}: PluginIconProps) => {
  const prevActiveRef = useRef(false);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;
    if (!wasActive || active) return;
    const startTimer = setTimeout(() => setFadingOut(true), 0);
    const endTimer = setTimeout(() => setFadingOut(false), 500);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(endTimer);
    };
  }, [active]);

  const isReady = tabState === 'ready';
  const hasSvg = !!iconSvg;
  const isDark = useIsDark();
  const activeSvg = isDark && iconDarkSvg ? iconDarkSvg : iconSvg;
  const inactiveSvg = isDark && iconDarkInactiveSvg ? iconDarkInactiveSvg : iconInactiveSvg;
  const rawSvg = isReady ? activeSvg : inactiveSvg;
  const svgToRender = tryGetSanitizedSvg(rawSvg, pluginName);
  const innerSize = Math.round(size * 0.6);
  const borderClasses = getBorderClasses(tabState, active, fadingOut);

  if (hasSvg && svgToRender) {
    return (
      <div className={`shrink-0 ${className}`} style={{ width: size, height: size }}>
        <div
          className={cn('flex h-full w-full items-center justify-center rounded', borderClasses)}
          style={{ width: size, height: size }}>
          <div
            className="overflow-hidden"
            style={{ width: innerSize, height: innerSize }}
            dangerouslySetInnerHTML={{ __html: svgToRender }}
          />
        </div>
      </div>
    );
  }

  const letter = getAvatarLetter(displayName, pluginName);
  const fontSize = Math.round(size * 0.55);

  return (
    <div className={`shrink-0 ${className}`} style={{ width: size, height: size }}>
      <div
        className={cn('flex h-full w-full items-center justify-center rounded', borderClasses)}
        style={{
          width: size,
          height: size,
          backgroundColor: getAvatarVar(pluginName),
        }}>
        <span className="select-none font-head text-white leading-none" style={{ fontSize, letterSpacing: '-0.02em' }}>
          {letter}
        </span>
      </div>
    </div>
  );
};

export { AVATAR_PALETTE_SIZE, getAvatarLetter, getAvatarVar, hashString, tryGetSanitizedSvg, PluginIcon };
