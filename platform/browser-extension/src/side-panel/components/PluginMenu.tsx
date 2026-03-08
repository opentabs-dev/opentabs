import { ArrowUpCircle, ExternalLink, FolderOpen, MoreHorizontal, Package, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { PluginState } from '../bridge';
import { openFolder } from '../bridge';
import { Button } from './retro/Button';
import { Dialog } from './retro/Dialog';
import { Loader } from './retro/Loader';
import { Menu } from './retro/Menu';

interface PluginMenuProps {
  plugin: PluginState;
  onUpdate: () => void;
  onRemove: () => void;
  updating: boolean;
  removing: boolean;
  /** Use muted icon color (for inactive/disconnected plugins). */
  muted?: boolean;
  className?: string;
}

const VersionItem = ({ plugin }: { plugin: PluginState }) => {
  if (plugin.source === 'npm') {
    return (
      <Menu.Item onSelect={() => window.open(`https://www.npmjs.com/package/${plugin.name}`, '_blank')}>
        <Package className="h-3.5 w-3.5" />v{plugin.version}
        <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
      </Menu.Item>
    );
  }
  const { sourcePath } = plugin;
  if (sourcePath) {
    return (
      <Menu.Item onSelect={() => void openFolder(sourcePath)}>
        <Package className="h-3.5 w-3.5" />v{plugin.version}
        <FolderOpen className="ml-auto h-3 w-3 text-muted-foreground" />
      </Menu.Item>
    );
  }
  return (
    <Menu.Item disabled className="text-muted-foreground">
      <Package className="h-3.5 w-3.5" />v{plugin.version}
    </Menu.Item>
  );
};

const PluginMenu = ({ plugin, onUpdate, onRemove, updating, removing, muted, className }: PluginMenuProps) => {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isLocal = plugin.source === 'local';
  const removeLabel = isLocal ? 'Remove' : 'Uninstall';

  const handleConfirmRemove = () => {
    setConfirmOpen(false);
    onRemove();
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
            className="relative flex h-6 w-6 items-center justify-center rounded hover:bg-muted/50"
            aria-label="Plugin options">
            <MoreHorizontal className={`h-4 w-4 ${muted ? 'text-muted-foreground' : ''}`} />
            {plugin.update && (
              <div className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full border border-background bg-primary" />
            )}
          </button>
        </Menu.Trigger>
        <Menu.Content align="end">
          <VersionItem plugin={plugin} />
          <Menu.Separator />
          {plugin.update && (
            <Menu.Item onClick={onUpdate}>
              {updating ? <Loader size="sm" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}
              Update to v{plugin.update.latestVersion}
            </Menu.Item>
          )}
          {plugin.update && <Menu.Separator />}
          <Menu.Item onSelect={() => setConfirmOpen(true)} variant="destructive">
            {removing ? <Loader size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
            {removeLabel}
          </Menu.Item>
        </Menu.Content>
      </Menu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Content>
          <Dialog.Header className="border-destructive bg-destructive text-destructive-foreground">
            {removeLabel} Plugin
          </Dialog.Header>
          <Dialog.Body>
            <p className="text-foreground text-sm">
              Are you sure you want to {removeLabel.toLowerCase()}{' '}
              <strong className="font-head">{plugin.displayName}</strong>?
            </p>
            {isLocal ? (
              <p className="mt-1 text-muted-foreground text-xs">This will remove the plugin path from your config.</p>
            ) : (
              <p className="mt-1 text-muted-foreground text-xs">
                This will run npm uninstall and remove the plugin globally.
              </p>
            )}
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button size="sm" variant="outline">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive text-destructive"
              onClick={handleConfirmRemove}>
              {removeLabel}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </div>
  );
};

PluginMenu.displayName = 'PluginMenu';

export { PluginMenu };
export type { PluginMenuProps };
