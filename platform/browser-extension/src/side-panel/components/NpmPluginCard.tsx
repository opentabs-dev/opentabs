import { PluginIcon } from './PluginIcon';
import { Alert } from './retro/Alert';
import { Badge } from './retro/Badge';
import { Button } from './retro/Button';
import { Loader } from './retro/Loader';
import { extractShortName } from '../bridge';
import type { PluginSearchResult } from '../bridge';

interface NpmPluginCardProps {
  plugin: PluginSearchResult;
  installing: boolean;
  error: string | null;
  onInstall: () => void;
}

const NpmPluginCard = ({ plugin, installing, error, onInstall }: NpmPluginCardProps) => {
  const displayName = extractShortName(plugin.name);

  return (
    <div className="border-border bg-card space-y-2 rounded border-2 p-3 shadow-md transition-all hover:shadow-sm">
      {/* Header row: icon | name+meta | install button */}
      <div className="flex items-center gap-2">
        <PluginIcon pluginName={plugin.name} displayName={displayName} tabState="closed" size={28} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-head text-foreground truncate text-sm">{displayName}</span>
            <Badge variant="default" size="sm">
              {plugin.version}
            </Badge>
            {plugin.isOfficial && (
              <Badge size="sm" className="bg-primary/20 text-primary-foreground">
                OFFICIAL
              </Badge>
            )}
          </div>
          <span className="text-muted-foreground truncate font-mono text-xs">{plugin.author}</span>
        </div>
        <Button size="sm" variant="default" disabled={installing} onClick={onInstall} className="shrink-0">
          {installing ? <Loader size="sm" /> : 'Install'}
        </Button>
      </div>

      {/* Description */}
      <p className="text-muted-foreground line-clamp-2 text-xs">{plugin.description}</p>

      {/* Error */}
      {error && (
        <Alert status="error" className="px-3 py-2 text-xs">
          {error}
        </Alert>
      )}
    </div>
  );
};

NpmPluginCard.displayName = 'NpmPluginCard';

export { NpmPluginCard };
export type { NpmPluginCardProps };
