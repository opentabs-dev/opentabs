import { NpmPluginCard } from './NpmPluginCard';
import { PluginList } from './PluginList';
import { Loader } from './retro/Loader';
import { matchesPlugin } from '../bridge';
import type { FailedPluginState, PluginSearchResult, PluginState } from '../bridge';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

interface SearchResultsProps {
  plugins: PluginState[];
  failedPlugins: FailedPluginState[];
  activeTools: Set<string>;
  setPlugins: Dispatch<SetStateAction<PluginState[]>>;
  toolFilter: string;
  npmResults: PluginSearchResult[];
  npmSearching: boolean;
  installingPlugins: Set<string>;
  onInstall: (name: string) => void;
  installErrors: Map<string, string>;
}

/**
 * Extracts a normalized short name from an npm package name for deduplication.
 * "@opentabs-dev/opentabs-plugin-slack" → "slack"
 * "opentabs-plugin-datadog" → "datadog"
 * "slack" → "slack"
 */
const extractShortName = (name: string): string => (name.split('/').pop() ?? name).replace(/^opentabs-plugin-/, '');

const SectionHeader = ({ children }: { children: ReactNode }) => (
  <div className="font-head text-muted-foreground mb-1.5 text-[10px] tracking-widest uppercase">{children}</div>
);

const SearchResults = ({
  plugins,
  activeTools,
  setPlugins,
  toolFilter,
  npmResults,
  npmSearching,
  installingPlugins,
  onInstall,
  installErrors,
}: SearchResultsProps) => {
  const filterLower = toolFilter.toLowerCase();

  // Filter installed plugins using matchesPlugin (name + displayName + tools)
  const installedMatches = filterLower ? plugins.filter(p => matchesPlugin(p, filterLower)) : plugins;

  // Filter out npm results whose short name matches an already-installed plugin's short name
  const installedShortNames = new Set(plugins.map(p => extractShortName(p.name)));
  const availableResults = npmResults.filter(r => !installedShortNames.has(extractShortName(r.name)));

  const hasInstalledResults = installedMatches.length > 0;
  const showNoResults = toolFilter && !hasInstalledResults && !npmSearching && availableResults.length === 0;

  return (
    <div className="space-y-4">
      {/* INSTALLED section */}
      {hasInstalledResults && (
        <div>
          <SectionHeader>Installed</SectionHeader>
          <PluginList
            plugins={installedMatches}
            failedPlugins={[]}
            activeTools={activeTools}
            setPlugins={setPlugins}
            toolFilter=""
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
