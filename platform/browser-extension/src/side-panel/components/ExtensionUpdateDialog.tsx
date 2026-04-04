import { RefreshCw } from 'lucide-react';
import { Button } from './retro/Button.js';
import { Dialog } from './retro/Dialog.js';

interface ExtensionUpdateDialogProps {
  open: boolean;
}

const ExtensionUpdateDialog = ({ open }: ExtensionUpdateDialogProps) => (
  <Dialog open={open} onOpenChange={() => {}}>
    <Dialog.Content
      onInteractOutside={(e: Event) => e.preventDefault()}
      onEscapeKeyDown={(e: Event) => e.preventDefault()}>
      <div className="flex min-h-10 items-center border-border border-b-2 bg-primary px-4 text-primary-foreground">
        <span className="font-head text-sm">Extension Updated</span>
      </div>
      <Dialog.Body>
        <p className="text-foreground text-sm">
          A new version of the extension has been installed. Reload to apply the update.
        </p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button size="sm" onClick={() => chrome.runtime.reload()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Reload
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog>
);

export { ExtensionUpdateDialog };
