import { useState, useCallback, useRef } from 'react';

interface UseCopyFeedbackOptions {
  /** Duration in ms to show the "Copied!" feedback (default: 2000) */
  feedbackDuration?: number;
}

interface UseCopyFeedbackReturn {
  /** Whether the content was recently copied (for showing feedback) */
  copied: boolean;
  /** Copy text to clipboard and trigger feedback */
  copy: (text: string) => Promise<void>;
}

/**
 * Hook that provides clipboard copy functionality with visual feedback state.
 * Returns `copied: true` for a brief duration after copying.
 */
export const useCopyFeedback = (options: UseCopyFeedbackOptions = {}): UseCopyFeedbackReturn => {
  const { feedbackDuration = 2000 } = options;
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);

        // Clear any existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Reset after duration
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
          timeoutRef.current = null;
        }, feedbackDuration);
      } catch (err) {
        console.error('Failed to copy to clipboard:', err);
      }
    },
    [feedbackDuration],
  );

  return { copied, copy };
};
