import type { ToolPermission } from '@opentabs-dev/shared';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { BrowserToolState, FailedPluginState, PluginSearchResult, PluginState } from '../bridge';
import { extractShortName, matchesPlugin } from '../bridge';
import { BrowserToolsCard, toDisplayName } from './BrowserToolsCard';
import { NpmPluginCard } from './NpmPluginCard';
import { PluginList } from './PluginList';
import { Accordion } from './retro/Accordion';
import { Loader } from './retro/Loader';

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
  npmSearchError?: boolean;
  installingPlugins: Set<string>;
  onInstall: (name: string) => void;
  installErrors: Map<string, string>;
  onUpdate?: (pluginName: string) => void;
  onRemove?: (pluginName: string) => void;
  removingPlugins?: Set<string>;
  pluginErrors?: Map<string, string>;
  serverVersion?: string;
  browserPermission?: ToolPermission;
  onBrowserPermissionChange?: (permission: ToolPermission) => void;
}

const SectionHeader = ({ children }: { children: ReactNode }) => (
  <div className="mb-1.5 font-head text-[10px] text-muted-foreground uppercase tracking-widest">{children}</div>
);

/** Returns true if a browser tool matches the search filter */
const matchesBrowserTool = (tool: BrowserToolState, filterLower: string): boolean =>
  toDisplayName(tool.name).toLowerCase().includes(filterLower) ||
  tool.name.toLowerCase().includes(filterLower) ||
  tool.description.toLowerCase().includes(filterLower);

const SearchResults = ({
  plugins,
  failedPlugins,
  browserTools,
  activeTools,
  setPlugins,
  setBrowserTools,
  toolFilter,
  npmResults,
  npmSearching,
  npmSearchError,
  installingPlugins,
  onInstall,
  installErrors,
  onUpdate,
  onRemove,
  removingPlugins,
  pluginErrors,
  serverVersion,
  browserPermission = 'off',
  onBrowserPermissionChange,
}: SearchResultsProps) => {
  const filterLower = toolFilter.toLowerCase();

  // Filter installed plugins using matchesPlugin (name + displayName + tools)
  const installedMatches = filterLower ? plugins.filter(p => matchesPlugin(p, filterLower)) : plugins;

  // Filter failed plugins by specifier or error message
  const failedMatches = filterLower
    ? failedPlugins.filter(
        p => p.specifier.toLowerCase().includes(filterLower) || p.error.toLowerCase().includes(filterLower),
      )
    : failedPlugins;

  // Filter browser tools that match the search
  const hasBrowserToolMatches =
    browserTools.length > 0 &&
    (!filterLower || 'browser'.includes(filterLower) || browserTools.some(t => matchesBrowserTool(t, filterLower)));

  // Filter out npm results whose short name matches an already-installed plugin's short name
  const installedShortNames = new Set(plugins.map(p => extractShortName(p.name)));
  const availableResults = npmResults.filter(r => !installedShortNames.has(extractShortName(r.name)));

  const hasInstalledResults = installedMatches.length > 0 || failedMatches.length > 0 || hasBrowserToolMatches;
  const showNoResults =
    toolFilter && !hasInstalledResults && !npmSearching && !npmSearchError && availableResults.length === 0;

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
                browserPermission={browserPermission}
                onBrowserPermissionChange={onBrowserPermissionChange}
              />
            </Accordion>
          )}
          <PluginList
            plugins={installedMatches}
            failedPlugins={failedMatches}
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
        ) : npmSearchError ? (
          <div className="py-4 text-center text-muted-foreground text-sm">Search failed</div>
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
      {showNoResults && <div className="py-8 text-center text-muted-foreground text-sm">No results</div>}
    </div>
  );
};

SearchResults.displayName = 'SearchResults';

export { SearchResults };
export type { SearchResultsProps };
