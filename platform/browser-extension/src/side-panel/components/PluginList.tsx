import { FailedPluginCard } from './FailedPluginCard.js';
import { PluginCard } from './PluginCard.js';
import { Accordion } from './retro/Accordion.js';
import { matchesTool } from '../bridge.js';
import type { FailedPluginState, PluginState } from '../bridge.js';
import type { Dispatch, SetStateAction } from 'react';

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

  if (filterLower && visiblePlugins.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">No tools matching &ldquo;{toolFilter}&rdquo;</div>
    );
  }

  return (
    <>
      {visibleFailed.length > 0 && (
        <div className="mb-3 space-y-2">
          {visibleFailed.map(fp => (
            <FailedPluginCard key={fp.specifier} plugin={fp} />
          ))}
        </div>
      )}
      <Accordion type="multiple" className="space-y-2">
        {visiblePlugins.map(plugin => (
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
          />
        ))}
      </Accordion>
    </>
  );
};

export { PluginList };
