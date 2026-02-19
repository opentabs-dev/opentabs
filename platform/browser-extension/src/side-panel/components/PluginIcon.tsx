interface PluginIconProps {
  pluginName: string;
  size?: number;
  className?: string;
}

const PluginIcon = ({ size = 32, className = '' }: PluginIconProps) => (
  <div
    className={`border-border bg-muted flex shrink-0 items-center justify-center rounded border-2 ${className}`}
    style={{ width: size, height: size }}>
    <svg
      width={size * 0.5}
      height={size * 0.5}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </svg>
  </div>
);

export { PluginIcon };
