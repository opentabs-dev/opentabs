import { FolderOpen, MoreHorizontal, Server } from 'lucide-react';
import { openFolder } from '../bridge';
import { Menu } from './retro/Menu';

interface BrowserToolsMenuProps {
  serverVersion?: string;
  serverSourcePath?: string;
  className?: string;
}

const BrowserToolsMenu = ({ serverVersion, serverSourcePath, className }: BrowserToolsMenuProps) => (
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
        {serverSourcePath ? (
          <Menu.Item onSelect={() => void openFolder(serverSourcePath)}>
            <Server className="h-3.5 w-3.5" />
            Server {serverVersion ? `v${serverVersion}` : 'unknown'}
            <FolderOpen className="ml-auto h-3 w-3 text-muted-foreground" />
          </Menu.Item>
        ) : (
          <Menu.Item disabled className="text-muted-foreground">
            <Server className="h-3.5 w-3.5" />
            Server {serverVersion ? `v${serverVersion}` : 'unknown'}
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu>
  </div>
);

BrowserToolsMenu.displayName = 'BrowserToolsMenu';

export { BrowserToolsMenu };
export type { BrowserToolsMenuProps };
