import { PluginCard } from './PluginCard.js';
import { Accordion } from './retro/Accordion.js';
import type { PluginState } from '../bridge.js';
import type { Dispatch, SetStateAction } from 'react';

const PluginList = ({
  plugins,
  activeTools,
  setPlugins,
  toolFilter,
}: {
  plugins: PluginState[];
  activeTools: Set<string>;
  setPlugins: Dispatch<SetStateAction<PluginState[]>>;
  toolFilter: string;
}) => {
  const filterLower = toolFilter.toLowerCase();

  const visiblePlugins = filterLower
    ? plugins.filter(p =>
        p.tools.some(
          t => t.name.toLowerCase().includes(filterLower) || t.description.toLowerCase().includes(filterLower),
        ),
      )
    : plugins;

  if (filterLower && visiblePlugins.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">No tools matching &ldquo;{toolFilter}&rdquo;</div>
    );
  }

  return (
    <Accordion type="multiple" className="space-y-2">
      {visiblePlugins.map(plugin => (
        <PluginCard
          key={plugin.name}
          plugin={plugin}
          activeTools={activeTools}
          setPlugins={setPlugins}
          toolFilter={toolFilter}
        />
      ))}
    </Accordion>
  );
};

export { PluginList };
