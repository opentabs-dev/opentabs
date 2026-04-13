import { ArrowUpCircle, FolderOpen, MoreHorizontal, Package } from 'lucide-react';
import { useState } from 'react';
import { openFolder, selfUpdateServer } from '../bridge';
import { Loader } from './retro/Loader';
import { Menu } from './retro/Menu';

const SERVER_NPM_PACKAGE = '@opentabs-dev/mcp-server';

interface BrowserToolsMenuProps {
  serverVersion?: string;
  serverSourcePath?: string;
  serverUpdate?: { latestVersion: string; updateCommand: string };
  onUpdateError?: (message: string) => void;
  className?: string;
}

const isNpmInstall = (sourcePath: string): boolean => sourcePath.includes('node_modules');

const ServerVersionItem = ({
  serverVersion,
  serverSourcePath,
}: Pick<BrowserToolsMenuProps, 'serverVersion' | 'serverSourcePath'>) => {
  const label = `Server ${serverVersion ? `v${serverVersion}` : 'unknown'}`;

  if (serverSourcePath && isNpmInstall(serverSourcePath)) {
    return (
      <Menu.Item onSelect={() => window.open(`https://www.npmjs.com/package/${SERVER_NPM_PACKAGE}`, '_blank')}>
        <Package className="h-3.5 w-3.5" />
        {label}
      </Menu.Item>
    );
  }
  if (serverSourcePath) {
    return (
      <Menu.Item onSelect={() => void openFolder(serverSourcePath)}>
        <FolderOpen className="h-3.5 w-3.5" />
        {label}
      </Menu.Item>
    );
  }
  return (
    <Menu.Item disabled className="text-muted-foreground">
      <Package className="h-3.5 w-3.5" />
      {label}
    </Menu.Item>
  );
};

const BrowserToolsMenu = ({
  serverVersion,
  serverSourcePath,
  serverUpdate,
  onUpdateError,
  className,
}: BrowserToolsMenuProps) => {
  const [updating, setUpdating] = useState(false);

  const handleUpdate = () => {
    if (updating) return;
    setUpdating(true);
    selfUpdateServer()
      .catch((err: unknown) => {
        onUpdateError?.(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setUpdating(false));
  };

  return (
    <div
      className={className}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
      role="presentation">
      <Menu>
        <Menu.Trigger asChild>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted/50"
            aria-label="Browser tools options">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </Menu.Trigger>
        <Menu.Content align="end">
          {serverUpdate && (
            <Menu.Item onSelect={handleUpdate} disabled={updating}>
              {updating ? <Loader size="sm" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}
              Update to v{serverUpdate.latestVersion}
            </Menu.Item>
          )}
          <ServerVersionItem serverVersion={serverVersion} serverSourcePath={serverSourcePath} />
        </Menu.Content>
      </Menu>
    </div>
  );
};

BrowserToolsMenu.displayName = 'BrowserToolsMenu';

export type { BrowserToolsMenuProps };
export { BrowserToolsMenu };
