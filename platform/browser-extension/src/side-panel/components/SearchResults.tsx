import { BrowserToolsCard, toDisplayName } from './BrowserToolsCard';
import { NpmPluginCard } from './NpmPluginCard';
import { PluginList } from './PluginList';
import { Accordion } from './retro/Accordion';
import { Loader } from './retro/Loader';
import { extractShortName, matchesPlugin } from '../bridge';
import type { BrowserToolState, FailedPluginState, PluginSearchResult, PluginState } from '../bridge';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

interface SearchResultsProps {
  plugins: PluginState[];
  failedPlugins: FailedPluginState[];
  browserTools: BrowserToolState[];
  activeTools: Set<string>;
  setPlugins: Dispatch<SetStateAction<PluginState[]>>;
  setBrowserTools: Dispatch<SetStateAction<BrowserToolState[]>>;
  toolFilter: string;
  npmResults: PluginSearchResult[];
  npmSearching: boolean;
  installingPlugins: Set<string>;
  onInstall: (name: string) => void;
  installErrors: Map<string, string>;
  onUpdate?: (pluginName: string) => void;
  onRemove?: (pluginName: string) => void;
  removingPlugins?: Set<string>;
  pluginErrors?: Map<string, string>;
  serverVersion?: string;
}

const SectionHeader = ({ children }: { children: ReactNode }) => (
  <div className="font-head text-muted-foreground mb-1.5 text-[10px] tracking-widest uppercase">{children}</div>
);

/** Returns true if a browser tool matches the search filter */
const matchesBrowserTool = (tool: BrowserToolState, filterLower: string): boolean =>
  toDisplayName(tool.name).toLowerCase().includes(filterLower) ||
  tool.name.toLowerCase().includes(filterLower) ||
  tool.description.toLowerCase().includes(filterLower);

const SearchResults = ({
  plugins,
  browserTools,
  activeTools,
  setPlugins,
  setBrowserTools,
  toolFilter,
  npmResults,
  npmSearching,
  installingPlugins,
  onInstall,
  installErrors,
  onUpdate,
  onRemove,
  removingPlugins,
  pluginErrors,
  serverVersion,
}: SearchResultsProps) => {
  const filterLower = toolFilter.toLowerCase();

  // Filter installed plugins using matchesPlugin (name + displayName + tools)
  const installedMatches = filterLower ? plugins.filter(p => matchesPlugin(p, filterLower)) : plugins;

  // Filter browser tools that match the search
  const hasBrowserToolMatches =
    browserTools.length > 0 &&
    (!filterLower ||
      'browser tools'.includes(filterLower) ||
      browserTools.some(t => matchesBrowserTool(t, filterLower)));

  // Filter out npm results whose short name matches an already-installed plugin's short name
  const installedShortNames = new Set(plugins.map(p => extractShortName(p.name)));
  const availableResults = npmResults.filter(r => !installedShortNames.has(extractShortName(r.name)));

  const hasInstalledResults = installedMatches.length > 0 || hasBrowserToolMatches;
  const showNoResults = toolFilter && !hasInstalledResults && !npmSearching && availableResults.length === 0;

  return (
    <div className="space-y-4">
      {/* INSTALLED section */}
      {hasInstalledResults && (
        <div>
          <SectionHeader>Installed</SectionHeader>
          {hasBrowserToolMatches && (
            <Accordion type="multiple" className="mb-2 space-y-2">
              <BrowserToolsCard
                tools={browserTools}
                activeTools={activeTools}
                onToolsChange={setBrowserTools}
                toolFilter={toolFilter}
                serverVersion={serverVersion}
              />
            </Accordion>
          )}
          <PluginList
            plugins={installedMatches}
            failedPlugins={[]}
            activeTools={activeTools}
            setPlugins={setPlugins}
            toolFilter=""
            onUpdate={onUpdate}
            onRemove={onRemove}
            removingPlugins={removingPlugins}
            pluginErrors={pluginErrors}
          />
        </div>
      )}

      {/* AVAILABLE section — only shown when there is a search query */}
      {toolFilter &&
        (npmSearching ? (
          <div className="flex justify-center py-4">
            <Loader size="sm" />
          </div>
        ) : (
          availableResults.length > 0 && (
            <div>
              <SectionHeader>Available</SectionHeader>
              <div className="space-y-2">
                {availableResults.map(result => (
                  <NpmPluginCard
                    key={result.name}
                    plugin={result}
                    installing={installingPlugins.has(result.name)}
                    error={installErrors.get(result.name) ?? null}
                    onInstall={() => onInstall(result.name)}
                  />
                ))}
              </div>
            </div>
          )
        ))}

      {/* No results message */}
      {showNoResults && <div className="text-muted-foreground py-8 text-center text-sm">No results</div>}
    </div>
  );
};

SearchResults.displayName = 'SearchResults';

export { SearchResults };
export type { SearchResultsProps };
