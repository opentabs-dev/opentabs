import { AlertTriangle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { FailedPluginState } from '../bridge.js';
import { Alert } from './retro/Alert.js';
import { Button } from './retro/Button.js';
import { Dialog } from './retro/Dialog.js';
import { Loader } from './retro/Loader.js';

interface FailedPluginCardProps {
  plugin: FailedPluginState;
  onRemove: () => void;
  removing: boolean;
  actionError?: string | null;
}

const FailedPluginCard = ({ plugin, onRemove, removing, actionError }: FailedPluginCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirmRemove = () => {
    setConfirmOpen(false);
    onRemove();
  };

  return (
    <div className="rounded border-2 border-destructive/50 bg-destructive/10 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="font-head text-destructive text-sm">Failed to load</span>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={removing}
          className="cursor-pointer text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50">
          {removing ? <Loader size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="mt-1 truncate text-muted-foreground text-xs">{plugin.specifier}</div>
      <div className={`mt-1 select-text text-destructive/80 text-xs leading-snug ${expanded ? '' : 'line-clamp-2'}`}>
        {plugin.error}
      </div>
      {plugin.error.length > 100 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 cursor-pointer text-muted-foreground text-xs underline">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {actionError && (
        <Alert status="error" className="mt-2 px-2 py-1 text-xs">
          {actionError}
        </Alert>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Content>
          <Dialog.Header className="border-destructive bg-destructive text-destructive-foreground">
            Remove Plugin Path
          </Dialog.Header>
          <Dialog.Body>
            <p className="text-foreground text-sm">
              Are you sure you want to remove this plugin path from your config?
            </p>
            <p className="mt-2 break-all rounded border border-border bg-muted/50 p-2 font-mono text-xs">
              {plugin.specifier}
            </p>
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
              Remove
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </div>
  );
};

export type { FailedPluginCardProps };
export { FailedPluginCard };
