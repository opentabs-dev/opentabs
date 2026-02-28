import { Button } from './retro/Button.js';
import { Menu } from './retro/Menu.js';
import { Progress } from './retro/Progress.js';
import { Text } from './retro/Text.js';
import { COUNTDOWN_POLL_INTERVAL_MS } from '../constants.js';
import { ShieldAlert, ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { SpConfirmationRequestMessage } from '../../extension-messages.js';

type ConfirmationData = SpConfirmationRequestMessage['data'] & {
  /** Timestamp when the confirmation was received in the side panel */
  receivedAt: number;
};

type Decision = 'allow_once' | 'allow_always' | 'deny';
type Scope = 'tool_domain' | 'tool_all' | 'domain_all';

interface ConfirmationDialogProps {
  confirmations: ConfirmationData[];
  onRespond: (id: string, decision: Decision, scope?: Scope) => void;
  onDenyAll: () => void;
}

/** Renders a countdown bar and seconds remaining based on the confirmation timeout */
const CountdownBar = ({ timeoutMs, receivedAt }: { timeoutMs: number; receivedAt: number }) => {
  const [remaining, setRemaining] = useState(timeoutMs);

  useEffect(() => {
    const update = () => {
      const elapsed = Date.now() - receivedAt;
      const newRemaining = Math.max(0, timeoutMs - elapsed);
      setRemaining(newRemaining);
      if (newRemaining === 0) clearInterval(id);
    };
    const id = setInterval(update, COUNTDOWN_POLL_INTERVAL_MS);
    update();
    return () => clearInterval(id);
  }, [timeoutMs, receivedAt]);

  const seconds = Math.ceil(remaining / 1000);
  const fraction = remaining / timeoutMs;

  return (
    <div className="mt-2 flex items-center gap-2">
      <Progress
        value={fraction * 100}
        className="flex-1"
        indicatorClassName={fraction > 0.33 ? 'bg-accent-foreground' : 'bg-destructive'}
      />
      <span className="text-muted-foreground font-mono text-xs tabular-nums">{seconds}s</span>
    </div>
  );
};

/** Renders the "Allow Always" button with a scope dropdown */
const AllowAlwaysButton = ({ domain, onSelect }: { domain: string | null; onSelect: (scope: Scope) => void }) => (
  <Menu>
    <Menu.Trigger asChild>
      <Button size="sm" variant="outline" className="w-full gap-1 text-xs">
        Allow Always
        <ChevronDown className="h-3 w-3" />
      </Button>
    </Menu.Trigger>
    <Menu.Content side="top" align="end">
      <Menu.Item onSelect={() => onSelect('tool_domain')}>For this tool on this domain</Menu.Item>
      <Menu.Item onSelect={() => onSelect('tool_all')}>For this tool everywhere</Menu.Item>
      {domain && <Menu.Item onSelect={() => onSelect('domain_all')}>For all tools on {domain}</Menu.Item>}
    </Menu.Content>
  </Menu>
);

/**
 * Clamps a tracked index to valid bounds after the list shrinks.
 * When the item at `currentIndex` is removed, the index stays the same,
 * pointing to the next item that slid into its position. If the removed
 * item was the last one, the index clamps down to the new last position.
 */
const resolveDisplayIndex = (currentIndex: number, count: number): number => Math.min(currentIndex, count - 1);

const ConfirmationDialog = ({ confirmations, onRespond, onDenyAll }: ConfirmationDialogProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const safeIndex = resolveDisplayIndex(currentIndex, confirmations.length);
  const current = confirmations[safeIndex];
  if (!current) return null;

  const count = confirmations.length;

  return (
    <div className="mt-2 mr-5 ml-4" role="alert">
      <div className="border-accent-foreground bg-accent/30 rounded border-2 shadow-md">
        {/* Header */}
        <div className="border-accent-foreground flex items-center gap-2 border-b-2 px-3 py-2">
          <ShieldAlert className="text-accent-foreground h-4 w-4 shrink-0" />
          <Text as="h6" className="flex-1 text-sm">
            Approval Required
          </Text>
          {count > 1 && (
            <span className="text-muted-foreground font-mono text-xs">
              {safeIndex + 1} of {count}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="space-y-2 px-3 py-2">
          {/* Tool name */}
          <div>
            <span className="text-muted-foreground font-sans text-xs">Tool</span>
            <div className="font-mono text-sm">{current.tool}</div>
          </div>

          {/* Domain */}
          {current.domain && (
            <div>
              <span className="text-muted-foreground font-sans text-xs">Domain</span>
              <div className="font-sans text-sm">{current.domain}</div>
            </div>
          )}

          {/* Params preview */}
          {current.paramsPreview && (
            <div>
              <span className="text-muted-foreground font-sans text-xs">Parameters</span>
              <pre className="border-border bg-card mt-0.5 max-h-20 overflow-auto rounded border px-2 py-1 font-mono text-xs leading-tight">
                {current.paramsPreview}
              </pre>
            </div>
          )}

          {/* Countdown */}
          <CountdownBar timeoutMs={current.timeoutMs} receivedAt={current.receivedAt} />
        </div>

        {/* Actions */}
        <div className="border-accent-foreground flex flex-col gap-1.5 border-t-2 py-2 pr-4 pl-3">
          <Button size="sm" className="w-full" onClick={() => onRespond(current.id, 'allow_once')}>
            Allow Once
          </Button>
          <AllowAlwaysButton domain={current.domain} onSelect={scope => onRespond(current.id, 'allow_always', scope)} />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-destructive w-full text-xs"
              onClick={() => onRespond(current.id, 'deny')}>
              Deny
            </Button>
            {count > 1 && (
              <Button size="sm" variant="outline" className="text-destructive w-full text-xs" onClick={onDenyAll}>
                Deny All
              </Button>
            )}
          </div>
        </div>

        {/* Navigation for multiple confirmations */}
        {count > 1 && (
          <div className="border-border flex justify-center gap-2 border-t px-3 py-1">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground cursor-pointer font-mono text-xs disabled:cursor-not-allowed disabled:opacity-40"
              disabled={safeIndex === 0}
              onClick={() => setCurrentIndex(i => i - 1)}>
              prev
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground cursor-pointer font-mono text-xs disabled:cursor-not-allowed disabled:opacity-40"
              disabled={safeIndex >= count - 1}
              onClick={() => setCurrentIndex(i => i + 1)}>
              next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export { ConfirmationDialog, resolveDisplayIndex };
export type { ConfirmationData };
