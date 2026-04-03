import type { PluginSearchResult } from '../bridge';
import { PluginIcon } from './PluginIcon';
import { Alert } from './retro/Alert';
import { Badge } from './retro/Badge';
import { Button } from './retro/Button';
import { Loader } from './retro/Loader';

interface NpmPluginCardProps {
  plugin: PluginSearchResult;
  installing: boolean;
  error: string | null;
  onInstall: () => void;
}

const NpmPluginCard = ({ plugin, installing, error, onInstall }: NpmPluginCardProps) => {
  const displayName = plugin.displayName;

  return (
    <div className="space-y-2 rounded border-2 border-border bg-card p-3 shadow-md transition-all hover:shadow-sm">
      {/* Header row: icon | name+meta | install button */}
      <div className="flex items-center gap-2">
        <PluginIcon
          pluginName={plugin.name}
          displayName={displayName}
          tabState="closed"
          size={28}
          iconSvg={plugin.iconSvg || undefined}
          iconInactiveSvg={plugin.iconSvg || undefined}
          iconDarkSvg={plugin.iconDarkSvg || undefined}
          iconDarkInactiveSvg={plugin.iconDarkSvg || undefined}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-1">
            <a
              href={`https://www.npmjs.com/package/${plugin.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-head text-foreground text-sm hover:underline"
              onClick={e => e.stopPropagation()}>
              {displayName}
            </a>
            <Badge variant="default" size="sm">
              {plugin.version}
            </Badge>
          </div>
          <span className="truncate font-sans text-muted-foreground text-xs">{plugin.author}</span>
        </div>
        <Button size="sm" variant="default" disabled={installing} onClick={onInstall} className="shrink-0">
          {installing ? <Loader size="sm" /> : 'Install'}
        </Button>
      </div>

      {/* Description */}
      <p className="line-clamp-2 text-muted-foreground text-xs">{plugin.description}</p>

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

export type { NpmPluginCardProps };
export { NpmPluginCard };
