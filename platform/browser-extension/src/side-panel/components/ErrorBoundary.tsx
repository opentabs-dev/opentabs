import { Alert } from './retro/Alert.js';
import { Button } from './retro/Button.js';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Top-level error boundary for the side panel. Catches render errors and
 * displays a recoverable fallback UI instead of a white screen.
 *
 * React error boundaries must be class components — there is no hook-based
 * equivalent for componentDidCatch/getDerivedStateFromError.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[opentabs:side-panel] Render error caught by ErrorBoundary:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16 text-center">
          <Alert status="error" className="max-w-xs">
            <Alert.Title>Something went wrong</Alert.Title>
            <Alert.Description>The side panel encountered an unexpected error.</Alert.Description>
            <Button variant="default" size="sm" className="mt-4" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
