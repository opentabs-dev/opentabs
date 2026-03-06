import type { CSSProperties, ReactNode } from 'react';

/**
 * Explicit CSS variable values for light and dark themes.
 * Using inline styles guarantees correct theme isolation regardless of
 * the Storybook global theme toggle state. Values must match styles.css.
 */
const lightVars = {
  '--background': '#fff',
  '--foreground': '#000',
  '--card': '#fff',
  '--card-foreground': '#000',
  '--primary': '#ffdb33',
  '--primary-hover': '#ffcc00',
  '--primary-foreground': '#000',
  '--secondary': '#000',
  '--secondary-hover': '#1a1a1a',
  '--secondary-foreground': '#fff',
  '--muted': '#cccccc',
  '--muted-foreground': '#5a5a5a',
  '--accent': '#fae583',
  '--accent-foreground': '#000',
  '--destructive': '#e63946',
  '--destructive-foreground': '#fff',
  '--success': '#16a34a',
  '--success-foreground': '#fff',
  '--border': '#000',
  background: 'var(--background)',
  color: 'var(--foreground)',
} as CSSProperties;

const darkVars = {
  '--background': '#1a1a1a',
  '--foreground': '#f5f5f5',
  '--card': '#242424',
  '--card-foreground': '#f5f5f5',
  '--primary': '#ffdb33',
  '--primary-hover': '#ffcc00',
  '--primary-foreground': '#000',
  '--secondary': '#3a3a3a',
  '--secondary-hover': '#4a4a4a',
  '--secondary-foreground': '#f5f5f5',
  '--muted': '#3f3f46',
  '--muted-foreground': '#a0a0a0',
  '--accent': '#fae583',
  '--accent-foreground': '#000',
  '--destructive': '#e63946',
  '--destructive-foreground': '#fff',
  '--success': '#22c55e',
  '--success-foreground': '#000',
  '--border': '#5c5c5c',
  background: 'var(--background)',
  color: 'var(--foreground)',
} as CSSProperties;

const ThemeGrid = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-6">
    <div className="flex flex-col gap-2">
      <span className="font-mono text-muted-foreground text-xs">Light</span>
      <div className="w-80 rounded p-3" style={lightVars}>
        {children}
      </div>
    </div>
    <div className="flex flex-col gap-2">
      <span className="font-mono text-muted-foreground text-xs">Dark</span>
      <div className="w-80 rounded p-3" style={darkVars}>
        {children}
      </div>
    </div>
  </div>
);

export { ThemeGrid, lightVars, darkVars };
