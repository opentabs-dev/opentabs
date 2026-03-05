import type { TabState } from '@opentabs-dev/shared';
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import type { FailedPluginState, PluginState } from '../bridge.js';
import { matchesTool } from '../bridge.js';
import {
  buildStateSnapshot,
  collapseTransitioningItems,
  detectGroupChanges,
  FADE_IN_MS,
  getTransitionClass,
  groupPlugins,
} from '../group-transitions.js';
import { FailedPluginCard } from './FailedPluginCard.js';
import { PluginCard } from './PluginCard.js';
import { Accordion } from './retro/Accordion.js';

const ACCORDION_STORAGE_KEY = 'accordionState';

/**
 * React hook that tracks which plugins are currently animating after a group change.
 * Uses per-plugin timers to clear the animation class after FADE_IN_MS.
 */
function useGroupTransitions(plugins: PluginState[], isFiltering: boolean) {
  const prevStates = useRef<Map<string, TabState>>(new Map());
  const [animating, setAnimating] = useState<Set<string>>(new Set());
  const clearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (isFiltering) {
      prevStates.current = buildStateSnapshot(plugins);
      return;
    }

    const changed = detectGroupChanges(prevStates.current, plugins);
    prevStates.current = buildStateSnapshot(plugins);

    if (changed.size === 0) return;

    setAnimating(prev => {
      const next = new Set(prev);
      for (const name of changed) next.add(name);
      return next;
    });

    // Per-plugin timer so rapid successive transitions don't cancel each other
    for (const name of changed) {
      const existing = clearTimers.current.get(name);
      if (existing) clearTimeout(existing);
      clearTimers.current.set(
        name,
        setTimeout(() => {
          clearTimers.current.delete(name);
          setAnimating(prev => {
            if (!prev.has(name)) return prev;
            const next = new Set(prev);
            next.delete(name);
            return next;
          });
        }, FADE_IN_MS),
      );
    }
  }, [plugins, isFiltering]);

  // Cleanup all timers on unmount
  useEffect(
    () => () => {
      for (const timer of clearTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const resolveTransitionClass = useCallback(
    (pluginName: string, isReadyGroup: boolean): string | undefined =>
      getTransitionClass(pluginName, isReadyGroup, animating),
    [animating],
  );

  return { animating, resolveTransitionClass };
}

const PluginList = ({
  plugins,
  failedPlugins,
  activeTools,
  setPlugins,
  toolFilter,
  onUpdate,
  onRemove,
  removingPlugins,
  pluginErrors,
}: {
  plugins: PluginState[];
  failedPlugins: FailedPluginState[];
  activeTools: Set<string>;
  setPlugins: Dispatch<SetStateAction<PluginState[]>>;
  toolFilter: string;
  onUpdate?: (pluginName: string) => void;
  onRemove?: (pluginName: string) => void;
  removingPlugins?: Set<string>;
  pluginErrors?: Map<string, string>;
}) => {
  const filterLower = toolFilter.toLowerCase();

  const visiblePlugins = filterLower
    ? plugins.filter(p => (p.tools ?? []).some(t => matchesTool(t, filterLower)))
    : plugins;

  // Hide failed plugins when filtering tools
  const visibleFailed = filterLower ? [] : failedPlugins;

  const { animating, resolveTransitionClass } = useGroupTransitions(plugins, !!filterLower);

  // Controlled accordion state — collapse cards when they change groups
  const [openReady, setOpenReady] = useState<string[]>([]);
  const [openNotReady, setOpenNotReady] = useState<string[]>([]);

  // Hydrate accordion state from chrome.storage.session on mount
  useEffect(() => {
    chrome.storage.session.get(ACCORDION_STORAGE_KEY).then(
      result => {
        const stored = result[ACCORDION_STORAGE_KEY] as { openReady: string[]; openNotReady: string[] } | undefined;
        if (stored) {
          if (Array.isArray(stored.openReady)) setOpenReady(stored.openReady);
          if (Array.isArray(stored.openNotReady)) setOpenNotReady(stored.openNotReady);
        }
      },
      () => {
        // Storage unavailable — keep defaults
      },
    );
  }, []);

  // Persist accordion state to chrome.storage.session on every change.
  // Writes immediately (no debounce) so state is flushed before the page
  // can close — chrome.storage.session.set() is async and cannot reliably
  // complete during unmount/beforeunload.
  useEffect(() => {
    if (filterLower) return;
    chrome.storage.session.set({ [ACCORDION_STORAGE_KEY]: { openReady, openNotReady } }).catch(() => {});
  }, [openReady, openNotReady, filterLower]);

  useEffect(() => {
    if (animating.size === 0) return;
    setOpenReady(prev => collapseTransitioningItems(prev, animating));
    setOpenNotReady(prev => collapseTransitioningItems(prev, animating));
  }, [animating]);

  // Group plugins by readiness (only when not filtering)
  const { ready: readyPlugins, notReady: notReadyPlugins } = filterLower
    ? { ready: [], notReady: [] }
    : groupPlugins(visiblePlugins);

  const hasNotReady = notReadyPlugins.length > 0;

  // Track whether the not-ready section was previously visible for label animation
  const prevHadNotReady = useRef(false);
  const [labelVisible, setLabelVisible] = useState(false);
  const [labelMounted, setLabelMounted] = useState(false);

  useEffect(() => {
    let unmountTimer: ReturnType<typeof setTimeout> | undefined;

    if (filterLower) {
      setLabelMounted(false);
      setLabelVisible(false);
      prevHadNotReady.current = false;
    } else if (hasNotReady && !prevHadNotReady.current) {
      setLabelMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setLabelVisible(true);
        });
      });
      prevHadNotReady.current = hasNotReady;
    } else if (!hasNotReady && prevHadNotReady.current) {
      setLabelVisible(false);
      unmountTimer = setTimeout(() => setLabelMounted(false), FADE_IN_MS);
      prevHadNotReady.current = hasNotReady;
    } else if (hasNotReady) {
      setLabelMounted(true);
      setLabelVisible(true);
      prevHadNotReady.current = hasNotReady;
    }

    return () => clearTimeout(unmountTimer);
  }, [hasNotReady, filterLower]);

  if (filterLower && visiblePlugins.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">No tools matching &ldquo;{toolFilter}&rdquo;</div>
    );
  }

  const renderCard = (plugin: PluginState, isReadyGroup: boolean) => (
    <PluginCard
      key={plugin.name}
      plugin={plugin}
      activeTools={activeTools}
      setPlugins={setPlugins}
      toolFilter={toolFilter}
      onUpdate={onUpdate ? () => onUpdate(plugin.name) : undefined}
      onRemove={onRemove ? () => onRemove(plugin.name) : undefined}
      removingPlugin={removingPlugins?.has(plugin.name)}
      actionError={pluginErrors?.get(plugin.name) ?? null}
      transitionClass={resolveTransitionClass(plugin.name, isReadyGroup)}
    />
  );

  return (
    <>
      {visibleFailed.length > 0 && (
        <div className="mb-3 space-y-2">
          {visibleFailed.map(fp => (
            <FailedPluginCard key={fp.specifier} plugin={fp} />
          ))}
        </div>
      )}
      {filterLower ? (
        <Accordion type="multiple" className="space-y-2">
          {visiblePlugins.map(p => renderCard(p, true))}
        </Accordion>
      ) : (
        <>
          {readyPlugins.length > 0 && (
            <Accordion type="multiple" value={openReady} onValueChange={setOpenReady} className="space-y-2">
              {readyPlugins.map(p => renderCard(p, true))}
            </Accordion>
          )}
          {labelMounted && (
            <div
              className={`px-3 pt-3 pb-1 font-mono text-[10px] text-muted-foreground uppercase tracking-widest transition-opacity duration-200 ${labelVisible ? 'opacity-100' : 'opacity-0'}`}>
              NOT CONNECTED
            </div>
          )}
          {notReadyPlugins.length > 0 && (
            <Accordion type="multiple" value={openNotReady} onValueChange={setOpenNotReady} className="space-y-2">
              {notReadyPlugins.map(p => renderCard(p, false))}
            </Accordion>
          )}
        </>
      )}
    </>
  );
};

export { PluginList };
