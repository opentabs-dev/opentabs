/**
 * Inline SVG illustrations for docs pages.
 * Neo-brutalist style:
 * - CSS variables for theming (--color-foreground, --color-primary, --color-background)
 * - var(--font-mono) for text
 * - 3px strokeWidth on main borders
 * - Hard drop shadows (offset rect)
 * - Box-with-header-bar pattern
 * - No border-radius
 */

/**
 * ArchitectureIllustration — 3-box architecture diagram showing
 * AI Agent ↔ OpenTabs Server ↔ Your Browser with MCP and WebSocket arrows.
 * Used on the homepage and the architecture docs page.
 */
export const ArchitectureIllustration = () => (
  <svg viewBox="0 0 880 320" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" aria-hidden="true">
    <defs>
      <marker id="arch-arrow-right" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
        <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-foreground)" />
      </marker>
      <marker id="arch-arrow-left" markerWidth="10" markerHeight="10" refX="2" refY="4" orient="auto">
        <path d="M10,0 L0,4 L10,8 Z" fill="var(--color-foreground)" />
      </marker>
    </defs>

    {/* ── Box 1: AI Agent ──────────────────────────────── */}
    {/* Shadow */}
    <rect x="8" y="48" width="200" height="240" fill="var(--color-foreground)" />
    {/* Body */}
    <rect
      x="4"
      y="44"
      width="200"
      height="240"
      fill="var(--color-background)"
      stroke="var(--color-foreground)"
      strokeWidth="3"
    />
    {/* Header */}
    <rect x="4" y="44" width="200" height="40" fill="var(--color-foreground)" />
    <text
      x="104"
      y="70"
      fontSize="13"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-primary)"
      fontWeight="bold"
      textAnchor="middle">
      AI Agent
    </text>

    {/* Terminal-style content */}
    <text
      x="20"
      y="112"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      opacity="0.5">
      {'>'} thinking...
    </text>
    <text
      x="20"
      y="132"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      opacity="0.5">
      {'>'} calling tool
    </text>

    {/* Tool call chip */}
    <rect x="16" y="152" width="176" height="30" fill="var(--color-foreground)" />
    <text
      x="104"
      y="172"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-primary)"
      textAnchor="middle">
      slack_send_message()
    </text>

    {/* Result chip */}
    <rect
      x="16"
      y="196"
      width="176"
      height="30"
      fill="var(--color-background)"
      stroke="var(--color-foreground)"
      strokeWidth="2"
    />
    <text
      x="104"
      y="216"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      opacity="0.7"
      textAnchor="middle">
      result: message sent
    </text>

    {/* Agent labels */}
    <rect
      x="16"
      y="244"
      width="56"
      height="20"
      fill="var(--color-primary)"
      stroke="var(--color-foreground)"
      strokeWidth="1.5"
    />
    <text
      x="44"
      y="258"
      fontSize="8"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-primary-foreground)"
      fontWeight="bold"
      textAnchor="middle">
      Claude
    </text>
    <rect
      x="80"
      y="244"
      width="56"
      height="20"
      fill="var(--color-background)"
      stroke="var(--color-foreground)"
      strokeWidth="1.5"
    />
    <text
      x="108"
      y="258"
      fontSize="8"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      textAnchor="middle">
      Cursor
    </text>
    <rect
      x="144"
      y="244"
      width="44"
      height="20"
      fill="var(--color-background)"
      stroke="var(--color-foreground)"
      strokeWidth="1.5"
    />
    <text
      x="166"
      y="258"
      fontSize="8"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      textAnchor="middle">
      any
    </text>

    {/* ── Arrow 1: Agent -> MCP Server ─────────────────── */}
    <line
      x1="214"
      y1="148"
      x2="320"
      y2="148"
      stroke="var(--color-foreground)"
      strokeWidth="2"
      markerEnd="url(#arch-arrow-right)"
    />
    <line
      x1="214"
      y1="168"
      x2="320"
      y2="168"
      stroke="var(--color-foreground)"
      strokeWidth="2"
      strokeDasharray="6 4"
      markerEnd="url(#arch-arrow-left)"
    />
    <text
      x="267"
      y="140"
      fontSize="9"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      opacity="0.6"
      textAnchor="middle">
      MCP
    </text>

    {/* ── Box 2: MCP Server ────────────────────────────── */}
    {/* Shadow */}
    <rect x="336" y="48" width="200" height="240" fill="var(--color-foreground)" />
    {/* Body */}
    <rect
      x="332"
      y="44"
      width="200"
      height="240"
      fill="var(--color-primary)"
      stroke="var(--color-foreground)"
      strokeWidth="3"
    />
    {/* Header */}
    <rect x="332" y="44" width="200" height="40" fill="var(--color-foreground)" />
    <text
      x="432"
      y="70"
      fontSize="13"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-primary)"
      fontWeight="bold"
      textAnchor="middle">
      OpenTabs Server
    </text>

    {/* Server internals */}
    <rect
      x="348"
      y="100"
      width="168"
      height="28"
      fill="var(--color-foreground)"
      opacity="0.15"
      stroke="var(--color-foreground)"
      strokeWidth="1.5"
    />
    <text
      x="432"
      y="119"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      textAnchor="middle">
      Plugin Discovery
    </text>

    <rect
      x="348"
      y="138"
      width="168"
      height="28"
      fill="var(--color-foreground)"
      opacity="0.15"
      stroke="var(--color-foreground)"
      strokeWidth="1.5"
    />
    <text
      x="432"
      y="157"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      textAnchor="middle">
      Tool Registry
    </text>

    <rect
      x="348"
      y="176"
      width="168"
      height="28"
      fill="var(--color-foreground)"
      opacity="0.15"
      stroke="var(--color-foreground)"
      strokeWidth="1.5"
    />
    <text
      x="432"
      y="195"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      textAnchor="middle">
      Tool Dispatch
    </text>

    {/* localhost label */}
    <text
      x="432"
      y="240"
      fontSize="9"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      opacity="0.5"
      textAnchor="middle">
      localhost:9515
    </text>

    {/* ── Arrow 2: MCP Server -> Extension ─────────────── */}
    <line
      x1="542"
      y1="148"
      x2="648"
      y2="148"
      stroke="var(--color-foreground)"
      strokeWidth="2"
      markerEnd="url(#arch-arrow-right)"
    />
    <line
      x1="542"
      y1="168"
      x2="648"
      y2="168"
      stroke="var(--color-foreground)"
      strokeWidth="2"
      strokeDasharray="6 4"
      markerEnd="url(#arch-arrow-left)"
    />
    <text
      x="595"
      y="140"
      fontSize="9"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      opacity="0.6"
      textAnchor="middle">
      WebSocket
    </text>

    {/* ── Box 3: Browser / Extension ───────────────────── */}
    {/* Shadow */}
    <rect x="664" y="48" width="212" height="240" fill="var(--color-foreground)" />
    {/* Body */}
    <rect
      x="660"
      y="44"
      width="212"
      height="240"
      fill="var(--color-background)"
      stroke="var(--color-foreground)"
      strokeWidth="3"
    />
    {/* Browser chrome */}
    <rect x="660" y="44" width="212" height="40" fill="var(--color-foreground)" />
    {/* Traffic lights */}
    <circle cx="680" cy="64" r="5" fill="var(--color-primary)" />
    <circle cx="696" cy="64" r="5" fill="var(--color-background)" opacity="0.4" />
    <circle cx="712" cy="64" r="5" fill="var(--color-background)" opacity="0.4" />
    <text
      x="780"
      y="69"
      fontSize="11"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-primary)"
      opacity="0.8"
      textAnchor="middle">
      Your Browser
    </text>

    {/* Tab rows representing different web apps */}
    <rect
      x="676"
      y="100"
      width="180"
      height="32"
      fill="var(--color-primary)"
      stroke="var(--color-foreground)"
      strokeWidth="2"
    />
    <text
      x="692"
      y="121"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-primary-foreground)"
      fontWeight="bold">
      Slack
    </text>
    <rect x="780" y="108" width="64" height="16" fill="var(--color-foreground)" />
    <text
      x="812"
      y="120"
      fontSize="7"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-primary)"
      textAnchor="middle">
      adapter.js
    </text>

    <rect
      x="676"
      y="140"
      width="180"
      height="32"
      fill="var(--color-background)"
      stroke="var(--color-foreground)"
      strokeWidth="2"
    />
    <text x="692" y="161" fontSize="10" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
      Linear
    </text>
    <rect x="780" y="148" width="64" height="16" fill="var(--color-foreground)" />
    <text
      x="812"
      y="160"
      fontSize="7"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-primary)"
      textAnchor="middle">
      adapter.js
    </text>

    <rect
      x="676"
      y="180"
      width="180"
      height="32"
      fill="var(--color-background)"
      stroke="var(--color-foreground)"
      strokeWidth="2"
    />
    <text x="692" y="201" fontSize="10" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
      GitHub
    </text>
    <rect x="780" y="188" width="64" height="16" fill="var(--color-foreground)" />
    <text
      x="812"
      y="200"
      fontSize="7"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-primary)"
      textAnchor="middle">
      adapter.js
    </text>

    <rect
      x="676"
      y="220"
      width="180"
      height="32"
      fill="var(--color-background)"
      stroke="var(--color-foreground)"
      strokeWidth="1.5"
      strokeDasharray="4 3"
    />
    <text
      x="766"
      y="241"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      opacity="0.4"
      textAnchor="middle">
      any web app...
    </text>

    {/* ── Bottom label bar ─────────────────────────────── */}
    <text
      x="104"
      y="310"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      opacity="0.4"
      textAnchor="middle">
      Any MCP client
    </text>
    <text
      x="432"
      y="310"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      opacity="0.4"
      textAnchor="middle">
      Discovers plugins, routes calls
    </text>
    <text
      x="766"
      y="310"
      fontSize="10"
      fontFamily="var(--font-mono), monospace"
      fill="var(--color-foreground)"
      opacity="0.4"
      textAnchor="middle">
      Your session, your tabs
    </text>
  </svg>
);

/**
 * QuickStartFlow — 3-step flow for the Quick Start page.
 * Install → Start → Use, with arrows between steps.
 */
export const QuickStartFlow = () => (
  <div className="my-8">
    <svg viewBox="0 0 800 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" aria-hidden="true">
      <defs>
        <marker id="qs-arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
          <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-foreground)" />
        </marker>
      </defs>

      {/* ── Step 1: Install ───────────────────────────────── */}
      {/* Shadow */}
      <rect x="8" y="18" width="200" height="120" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="4"
        y="14"
        width="200"
        height="120"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="4" y="14" width="200" height="36" fill="var(--color-foreground)" />
      <text
        x="104"
        y="38"
        fontSize="13"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        1. Install
      </text>
      {/* Content */}
      <rect x="16" y="64" width="176" height="26" fill="var(--color-foreground)" />
      <text
        x="104"
        y="82"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        npm i -g @opentabs-dev/cli
      </text>
      <text
        x="104"
        y="118"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        + Load Chrome extension
      </text>

      {/* ── Arrow 1→2 ────────────────────────────────────── */}
      <line
        x1="214"
        y1="74"
        x2="290"
        y2="74"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#qs-arrow)"
      />

      {/* ── Step 2: Start ────────────────────────────────── */}
      {/* Shadow */}
      <rect x="308" y="18" width="200" height="120" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="304"
        y="14"
        width="200"
        height="120"
        fill="var(--color-primary)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="304" y="14" width="200" height="36" fill="var(--color-foreground)" />
      <text
        x="404"
        y="38"
        fontSize="13"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        2. Start
      </text>
      {/* Content */}
      <rect x="316" y="64" width="176" height="26" fill="var(--color-foreground)" />
      <text
        x="404"
        y="82"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        opentabs start
      </text>
      <text
        x="404"
        y="118"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        localhost:9515
      </text>

      {/* ── Arrow 2→3 ────────────────────────────────────── */}
      <line
        x1="514"
        y1="74"
        x2="590"
        y2="74"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#qs-arrow)"
      />

      {/* ── Step 3: Use ──────────────────────────────────── */}
      {/* Shadow */}
      <rect x="608" y="18" width="188" height="120" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="604"
        y="14"
        width="188"
        height="120"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="604" y="14" width="188" height="36" fill="var(--color-foreground)" />
      <text
        x="698"
        y="38"
        fontSize="13"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        3. Use
      </text>
      {/* Content */}
      <rect x="616" y="64" width="164" height="26" fill="var(--color-foreground)" />
      <text
        x="698"
        y="82"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        slack_send_message()
      </text>
      <text
        x="698"
        y="118"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        AI agent calls tools
      </text>
    </svg>
  </div>
);

/**
 * ConfigDirectory — directory structure diagram for the Configuration reference page.
 * Shows the ~/.opentabs/ directory layout as a terminal-window tree.
 */
export const ConfigDirectory = () => (
  <div className="my-8">
    <svg
      viewBox="0 0 520 300"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-lg"
      aria-hidden="true">
      {/* ── Main box ──────────────────────────────────────── */}
      {/* Shadow */}
      <rect x="8" y="8" width="508" height="288" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="4"
        y="4"
        width="508"
        height="288"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="4" y="4" width="508" height="36" fill="var(--color-foreground)" />
      {/* Traffic lights */}
      <circle cx="24" cy="22" r="5" fill="var(--color-primary)" />
      <circle cx="40" cy="22" r="5" fill="var(--color-background)" opacity="0.4" />
      <circle cx="56" cy="22" r="5" fill="var(--color-background)" opacity="0.4" />
      <text
        x="258"
        y="27"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        ~/.opentabs/
      </text>

      {/* ── File tree ─────────────────────────────────────── */}
      {/* config.json */}
      <text x="28" y="68" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        config.json
      </text>
      <text
        x="220"
        y="68"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Configuration (0600, created on first run)
      </text>

      {/* audit.log */}
      <text x="28" y="94" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        audit.log
      </text>
      <text
        x="220"
        y="94"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Tool invocation log (NDJSON, append-only)
      </text>

      {/* server.log */}
      <text x="28" y="120" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        server.log
      </text>
      <text
        x="220"
        y="120"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Server output (written by opentabs start)
      </text>

      {/* Divider */}
      <line x1="20" y1="136" x2="500" y2="136" stroke="var(--color-foreground)" strokeWidth="1" opacity="0.15" />

      {/* extension/ directory */}
      <text
        x="28"
        y="160"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        extension/
      </text>
      <text
        x="220"
        y="160"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Chrome extension (managed by opentabs start)
      </text>

      {/* extension/manifest.json */}
      <text x="62" y="186" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        manifest.json
      </text>

      {/* extension/dist/ */}
      <text
        x="62"
        y="212"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        dist/
      </text>
      <text
        x="220"
        y="212"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Compiled extension JS
      </text>

      {/* extension/auth.json */}
      <text x="62" y="238" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        auth.json
      </text>
      <text
        x="220"
        y="238"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Auth secret (written on server start)
      </text>

      {/* extension/adapters/ */}
      <text
        x="62"
        y="264"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        adapters/
      </text>
      <text
        x="220"
        y="264"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Plugin adapter IIFEs (one per plugin)
      </text>

      {/* extension/.opentabs-version */}
      <text
        x="62"
        y="286"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        .opentabs-version
      </text>
    </svg>
  </div>
);

/**
 * MonorepoStructure — project structure diagram for the Dev Setup page.
 * Shows the top-level monorepo layout as a terminal-window tree.
 */
export const MonorepoStructure = () => (
  <div className="my-8">
    <svg
      viewBox="0 0 560 530"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-lg"
      aria-hidden="true">
      {/* ── Main box ──────────────────────────────────────── */}
      {/* Shadow */}
      <rect x="8" y="8" width="548" height="518" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="4"
        y="4"
        width="548"
        height="518"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="4" y="4" width="548" height="36" fill="var(--color-foreground)" />
      {/* Traffic lights */}
      <circle cx="24" cy="22" r="5" fill="var(--color-primary)" />
      <circle cx="40" cy="22" r="5" fill="var(--color-background)" opacity="0.4" />
      <circle cx="56" cy="22" r="5" fill="var(--color-background)" opacity="0.4" />
      <text
        x="280"
        y="27"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        opentabs/
      </text>

      {/* ── platform/ ───────────────────────────────────────── */}
      <text
        x="28"
        y="68"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        platform/
      </text>
      <text
        x="240"
        y="68"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Core platform packages (npm workspaces)
      </text>

      {/* platform sub-entries */}
      <text x="62" y="94" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        mcp-server/
      </text>
      <text
        x="240"
        y="94"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        MCP server
      </text>

      <text x="62" y="120" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        browser-extension/
      </text>
      <text
        x="240"
        y="120"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Chrome extension (MV3)
      </text>

      <text x="62" y="146" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        plugin-sdk/
      </text>
      <text
        x="240"
        y="146"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Plugin authoring SDK
      </text>

      <text x="62" y="172" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        plugin-tools/
      </text>
      <text
        x="240"
        y="172"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Plugin developer CLI (opentabs-plugin)
      </text>

      <text x="62" y="198" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        cli/
      </text>
      <text
        x="240"
        y="198"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        User-facing CLI (opentabs)
      </text>

      <text x="62" y="224" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        shared/
      </text>
      <text
        x="240"
        y="224"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Shared types and utilities
      </text>

      <text x="62" y="250" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        create-plugin/
      </text>
      <text
        x="240"
        y="250"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Plugin scaffolding CLI
      </text>

      {/* Divider */}
      <line x1="20" y1="266" x2="540" y2="266" stroke="var(--color-foreground)" strokeWidth="1" opacity="0.15" />

      {/* ── plugins/ ────────────────────────────────────────── */}
      <text
        x="28"
        y="290"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        plugins/
      </text>
      <text
        x="240"
        y="290"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Example plugins (standalone, NOT in workspaces)
      </text>

      {/* plugins sub-entries */}
      <text x="62" y="316" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        slack/
      </text>
      <text
        x="240"
        y="316"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Slack plugin
      </text>

      <text x="62" y="342" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        e2e-test/
      </text>
      <text
        x="240"
        y="342"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Test plugin for E2E tests
      </text>

      {/* Divider */}
      <line x1="20" y1="358" x2="540" y2="358" stroke="var(--color-foreground)" strokeWidth="1" opacity="0.15" />

      {/* ── Top-level directories ───────────────────────────── */}
      <text
        x="28"
        y="382"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        e2e/
      </text>
      <text
        x="240"
        y="382"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Playwright E2E tests
      </text>

      <text
        x="28"
        y="408"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        scripts/
      </text>
      <text
        x="240"
        y="408"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Dev orchestrator, publish, install scripts
      </text>

      <text
        x="28"
        y="434"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        docs/
      </text>
      <text
        x="240"
        y="434"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Documentation site (Next.js)
      </text>

      {/* Dashed "more" entry */}
      <rect
        x="20"
        y="452"
        width="520"
        height="22"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      <text
        x="280"
        y="467"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.4"
        textAnchor="middle">
        tsconfig.json, eslint.config.ts, playwright.config.ts...
      </text>

      {/* Bottom label */}
      <text
        x="280"
        y="502"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.4"
        textAnchor="middle">
        platform/ linked via npm workspaces · plugins/ are standalone
      </text>
    </svg>
  </div>
);

/**
 * DispatchFlow — compact horizontal flow diagram for the Resources & Prompts page.
 * Shows the 5-step dispatch pipeline: AI Agent → MCP Server → Chrome Extension → Adapter IIFE → Page Context.
 */
export const DispatchFlow = () => (
  <div className="my-8">
    <svg
      viewBox="0 0 900 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-3xl"
      aria-hidden="true">
      <defs>
        <marker id="df-arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
          <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-foreground)" />
        </marker>
      </defs>

      {/* ── Box 1: AI Agent ─────────────────────────────── */}
      {/* Shadow */}
      <rect x="4" y="14" width="136" height="68" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="0"
        y="10"
        width="136"
        height="68"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="68"
        y="50"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        AI Agent
      </text>

      {/* ── Arrow 1→2 ──────────────────────────────────── */}
      <line
        x1="146"
        y1="44"
        x2="184"
        y2="44"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#df-arrow)"
      />

      {/* ── Box 2: MCP Server ──────────────────────────── */}
      {/* Shadow */}
      <rect x="198" y="14" width="136" height="68" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="194"
        y="10"
        width="136"
        height="68"
        fill="var(--color-primary)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="262"
        y="50"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        MCP Server
      </text>

      {/* ── Arrow 2→3 ──────────────────────────────────── */}
      <line
        x1="340"
        y1="44"
        x2="378"
        y2="44"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#df-arrow)"
      />

      {/* ── Box 3: Chrome Extension ────────────────────── */}
      {/* Shadow */}
      <rect x="392" y="14" width="136" height="68" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="388"
        y="10"
        width="136"
        height="68"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="456"
        y="44"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Chrome
      </text>
      <text
        x="456"
        y="58"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Extension
      </text>

      {/* ── Arrow 3→4 ──────────────────────────────────── */}
      <line
        x1="534"
        y1="44"
        x2="572"
        y2="44"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#df-arrow)"
      />

      {/* ── Box 4: Adapter IIFE ────────────────────────── */}
      {/* Shadow */}
      <rect x="586" y="14" width="136" height="68" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="582"
        y="10"
        width="136"
        height="68"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="650"
        y="44"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Adapter
      </text>
      <text
        x="650"
        y="58"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        IIFE
      </text>

      {/* ── Arrow 4→5 ──────────────────────────────────── */}
      <line
        x1="728"
        y1="44"
        x2="766"
        y2="44"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#df-arrow)"
      />

      {/* ── Box 5: Page Context ────────────────────────── */}
      {/* Shadow */}
      <rect x="780" y="14" width="116" height="68" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="776"
        y="10"
        width="116"
        height="68"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="834"
        y="44"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Page
      </text>
      <text
        x="834"
        y="58"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Context
      </text>
    </svg>
  </div>
);

/**
 * ProgressFlow — vertical 6-step flow diagram for the Streaming & Progress guide.
 * Shows the progress notification pipeline: Tool handler → Adapter IIFE → Content script →
 * Extension background → MCP server → AI agent, with transport labels on each arrow.
 */
export const ProgressFlow = () => (
  <div className="my-8">
    <svg
      viewBox="0 0 400 540"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-lg"
      aria-hidden="true">
      <defs>
        <marker id="pf-arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
          <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-foreground)" />
        </marker>
      </defs>

      {/* ── Step 1: Tool Handler (highlighted — developer's code) ── */}
      {/* Shadow */}
      <rect x="124" y="4" width="160" height="52" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="120"
        y="0"
        width="160"
        height="52"
        fill="var(--color-primary)"
        opacity="0.12"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="200"
        y="22"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Tool Handler
      </text>
      <text
        x="200"
        y="40"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        reportProgress()
      </text>

      {/* ── Arrow 1→2 ──────────────────────────────────── */}
      <line
        x1="200"
        y1="56"
        x2="200"
        y2="88"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#pf-arrow)"
      />
      <text
        x="282"
        y="78"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        CustomEvent
      </text>

      {/* ── Step 2: Adapter IIFE ──────────────────────── */}
      {/* Shadow */}
      <rect x="124" y="96" width="160" height="52" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="120"
        y="92"
        width="160"
        height="52"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="200"
        y="114"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Adapter IIFE
      </text>
      <text
        x="200"
        y="132"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        MAIN world
      </text>

      {/* ── Arrow 2→3 ──────────────────────────────────── */}
      <line
        x1="200"
        y1="148"
        x2="200"
        y2="180"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#pf-arrow)"
      />
      <text
        x="282"
        y="170"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        window.postMessage
      </text>

      {/* ── Step 3: Content Script Relay ──────────────── */}
      {/* Shadow */}
      <rect x="124" y="188" width="160" height="52" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="120"
        y="184"
        width="160"
        height="52"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="200"
        y="206"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Content Script
      </text>
      <text
        x="200"
        y="224"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        ISOLATED world relay
      </text>

      {/* ── Arrow 3→4 ──────────────────────────────────── */}
      <line
        x1="200"
        y1="240"
        x2="200"
        y2="272"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#pf-arrow)"
      />
      <text
        x="282"
        y="262"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        chrome.runtime
      </text>

      {/* ── Step 4: Extension Background ─────────────── */}
      {/* Shadow */}
      <rect x="124" y="280" width="160" height="52" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="120"
        y="276"
        width="160"
        height="52"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="200"
        y="298"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Extension
      </text>
      <text
        x="200"
        y="316"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Background service worker
      </text>

      {/* ── Arrow 4→5 ──────────────────────────────────── */}
      <line
        x1="200"
        y1="332"
        x2="200"
        y2="364"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#pf-arrow)"
      />
      <text
        x="282"
        y="354"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        WebSocket
      </text>

      {/* ── Step 5: MCP Server ───────────────────────── */}
      {/* Shadow */}
      <rect x="124" y="372" width="160" height="52" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="120"
        y="368"
        width="160"
        height="52"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="200"
        y="390"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        MCP Server
      </text>
      <text
        x="200"
        y="408"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Resets timeout, forwards
      </text>

      {/* ── Arrow 5→6 ──────────────────────────────────── */}
      <line
        x1="200"
        y1="424"
        x2="200"
        y2="456"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#pf-arrow)"
      />
      <text
        x="282"
        y="446"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        notifications/progress
      </text>

      {/* ── Step 6: AI Agent (highlighted — endpoint) ── */}
      {/* Shadow */}
      <rect x="124" y="464" width="160" height="52" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="120"
        y="460"
        width="160"
        height="52"
        fill="var(--color-primary)"
        opacity="0.12"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="200"
        y="482"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        AI Agent
      </text>
      <text
        x="200"
        y="500"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Live progress updates
      </text>

      {/* ── Step numbers ─────────────────────────────── */}
      <text
        x="108"
        y="22"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="end">
        1
      </text>
      <text
        x="108"
        y="114"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="end">
        2
      </text>
      <text
        x="108"
        y="206"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="end">
        3
      </text>
      <text
        x="108"
        y="298"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="end">
        4
      </text>
      <text
        x="108"
        y="390"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="end">
        5
      </text>
      <text
        x="108"
        y="482"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="end">
        6
      </text>
    </svg>
  </div>
);

/**
 * LifecycleSequence — vertical timeline showing the adapter lifecycle hooks
 * and when each fires. One-time hooks (onActivate, onDeactivate) use solid boxes;
 * repeating hooks (onNavigate, onToolInvocation*) use dashed borders with a repeat indicator.
 * Used on the Lifecycle Hooks SDK reference page.
 */
export const LifecycleSequence = () => (
  <div className="my-8">
    <svg
      viewBox="0 0 480 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-lg"
      aria-hidden="true">
      <defs>
        <marker id="lc-arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
          <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-foreground)" />
        </marker>
      </defs>

      {/* ── Central timeline line ──────────────────────── */}
      <line x1="60" y1="24" x2="60" y2="376" stroke="var(--color-foreground)" strokeWidth="2" opacity="0.2" />

      {/* ── Phase 1: Registration (once) ──────────────── */}
      {/* Timeline dot */}
      <circle cx="60" cy="30" r="6" fill="var(--color-foreground)" />
      {/* Shadow */}
      <rect x="88" y="12" width="372" height="40" fill="var(--color-foreground)" />
      {/* Body — solid box for one-time hook */}
      <rect
        x="84"
        y="8"
        width="372"
        height="40"
        fill="var(--color-primary)"
        opacity="0.12"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="100"
        y="28"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold">
        onActivate()
      </text>
      <text
        x="100"
        y="42"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        Once, after adapter registration
      </text>
      {/* "once" badge */}
      <rect x="388" y="18" width="52" height="18" fill="var(--color-foreground)" />
      <text
        x="414"
        y="31"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        once
      </text>

      {/* ── Arrow 1→2 ──────────────────────────────────── */}
      <line
        x1="60"
        y1="52"
        x2="60"
        y2="88"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#lc-arrow)"
      />

      {/* ── Phase 2: Navigation (repeating) ───────────── */}
      {/* Timeline dot */}
      <circle cx="60" cy="116" r="6" fill="var(--color-foreground)" />
      {/* Shadow */}
      <rect x="88" y="98" width="372" height="40" fill="var(--color-foreground)" />
      {/* Body — dashed border for repeating hook */}
      <rect
        x="84"
        y="94"
        width="372"
        height="40"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <text
        x="100"
        y="114"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold">
        onNavigate(url)
      </text>
      <text
        x="100"
        y="128"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        pushState, replaceState, popstate, hashchange
      </text>
      {/* "repeats" badge */}
      <rect
        x="374"
        y="104"
        width="66"
        height="18"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="1.5"
      />
      <text
        x="407"
        y="117"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6"
        textAnchor="middle">
        repeats
      </text>

      {/* ── Arrow 2→3 ──────────────────────────────────── */}
      <line
        x1="60"
        y1="138"
        x2="60"
        y2="174"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#lc-arrow)"
      />

      {/* ── Phase 3: Tool Invocation Start (repeating) ── */}
      {/* Timeline dot */}
      <circle cx="60" cy="202" r="6" fill="var(--color-foreground)" />
      {/* Shadow */}
      <rect x="88" y="184" width="372" height="40" fill="var(--color-foreground)" />
      {/* Body — dashed border for repeating hook */}
      <rect
        x="84"
        y="180"
        width="372"
        height="40"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <text
        x="100"
        y="200"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold">
        onToolInvocationStart(toolName)
      </text>
      <text
        x="100"
        y="214"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        {'Before each tool.handle()'}
      </text>
      {/* "repeats" badge */}
      <rect
        x="374"
        y="190"
        width="66"
        height="18"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="1.5"
      />
      <text
        x="407"
        y="203"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6"
        textAnchor="middle">
        repeats
      </text>

      {/* ── Arrow 3→4 ──────────────────────────────────── */}
      <line
        x1="60"
        y1="224"
        x2="60"
        y2="260"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#lc-arrow)"
      />

      {/* ── Phase 4: Tool Invocation End (repeating) ──── */}
      {/* Timeline dot */}
      <circle cx="60" cy="288" r="6" fill="var(--color-foreground)" />
      {/* Shadow */}
      <rect x="88" y="270" width="372" height="40" fill="var(--color-foreground)" />
      {/* Body — dashed border for repeating hook */}
      <rect
        x="84"
        y="266"
        width="372"
        height="40"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <text
        x="100"
        y="286"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold">
        onToolInvocationEnd(toolName, success, ms)
      </text>
      <text
        x="100"
        y="300"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        {'After each tool.handle() completes'}
      </text>
      {/* "repeats" badge */}
      <rect
        x="374"
        y="276"
        width="66"
        height="18"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="1.5"
      />
      <text
        x="407"
        y="289"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6"
        textAnchor="middle">
        repeats
      </text>

      {/* ── Arrow 4→5 ──────────────────────────────────── */}
      <line
        x1="60"
        y1="310"
        x2="60"
        y2="346"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#lc-arrow)"
      />

      {/* ── Phase 5: Removal (once) ───────────────────── */}
      {/* Timeline dot */}
      <circle cx="60" cy="374" r="6" fill="var(--color-foreground)" />
      {/* Shadow */}
      <rect x="88" y="356" width="372" height="40" fill="var(--color-foreground)" />
      {/* Body — solid box for one-time hook */}
      <rect
        x="84"
        y="352"
        width="372"
        height="40"
        fill="var(--color-primary)"
        opacity="0.12"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      <text
        x="100"
        y="372"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold">
        onDeactivate()
      </text>
      <text
        x="100"
        y="386"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        Before teardown, on removal or navigation away
      </text>
      {/* "once" badge */}
      <rect x="388" y="362" width="52" height="18" fill="var(--color-foreground)" />
      <text
        x="414"
        y="375"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        once
      </text>
    </svg>
  </div>
);

/**
 * ErrorCategories — 2-column grid showing the 6 ToolError categories grouped by
 * retryable vs non-retryable. Each card shows the category name, factory method,
 * and retry status. Used on the Error Handling guide page.
 */
export const ErrorCategories = () => (
  <div className="my-8">
    <svg
      viewBox="0 0 560 290"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-3xl"
      aria-hidden="true">
      {/* ── Column header: Not Retryable ──────────────── */}
      <text
        x="170"
        y="16"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Not Retryable
      </text>
      <line x1="80" y1="24" x2="260" y2="24" stroke="var(--color-foreground)" strokeWidth="1" opacity="0.3" />

      {/* ── Column header: Retryable ─────────────────── */}
      <text
        x="430"
        y="16"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        fontWeight="bold"
        textAnchor="middle">
        Retryable
      </text>
      <line x1="340" y1="24" x2="520" y2="24" stroke="var(--color-foreground)" strokeWidth="1" opacity="0.3" />

      {/* ── Card 1: auth (not retryable) ─────────────── */}
      {/* Shadow */}
      <rect x="24" y="40" width="280" height="52" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="20"
        y="36"
        width="280"
        height="52"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header strip */}
      <rect x="20" y="36" width="280" height="24" fill="var(--color-foreground)" />
      <text
        x="32"
        y="52"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        auth
      </text>
      <text
        x="288"
        y="52"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="end">
        No
      </text>
      <text
        x="32"
        y="78"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6">
        ToolError.auth(msg)
      </text>

      {/* ── Card 2: not_found (not retryable) ────────── */}
      {/* Shadow */}
      <rect x="24" y="104" width="280" height="52" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="20"
        y="100"
        width="280"
        height="52"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header strip */}
      <rect x="20" y="100" width="280" height="24" fill="var(--color-foreground)" />
      <text
        x="32"
        y="116"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        not_found
      </text>
      <text
        x="288"
        y="116"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="end">
        No
      </text>
      <text
        x="32"
        y="142"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6">
        ToolError.notFound(msg, code?)
      </text>

      {/* ── Card 3: validation (not retryable) ───────── */}
      {/* Shadow */}
      <rect x="24" y="168" width="280" height="52" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="20"
        y="164"
        width="280"
        height="52"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header strip */}
      <rect x="20" y="164" width="280" height="24" fill="var(--color-foreground)" />
      <text
        x="32"
        y="180"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        validation
      </text>
      <text
        x="288"
        y="180"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="end">
        No
      </text>
      <text
        x="32"
        y="206"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6">
        ToolError.validation(msg)
      </text>

      {/* ── Card 4: internal (not retryable) ─────────── */}
      {/* Shadow */}
      <rect x="24" y="232" width="280" height="52" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="20"
        y="228"
        width="280"
        height="52"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header strip */}
      <rect x="20" y="228" width="280" height="24" fill="var(--color-foreground)" />
      <text
        x="32"
        y="244"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        internal
      </text>
      <text
        x="288"
        y="244"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="end">
        No
      </text>
      <text
        x="32"
        y="270"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6">
        ToolError.internal(msg)
      </text>

      {/* ── Vertical divider ─────────────────────────── */}
      <line x1="318" y1="36" x2="318" y2="280" stroke="var(--color-foreground)" strokeWidth="1" opacity="0.15" />

      {/* ── Card 5: rate_limit (retryable, highlighted) ─ */}
      {/* Shadow */}
      <rect x="344" y="40" width="200" height="116" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="340"
        y="36"
        width="200"
        height="116"
        fill="var(--color-primary)"
        opacity="0.12"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header strip */}
      <rect x="340" y="36" width="200" height="24" fill="var(--color-foreground)" />
      <text
        x="352"
        y="52"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        rate_limit
      </text>
      <text
        x="528"
        y="52"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="end">
        Yes
      </text>
      <text
        x="352"
        y="78"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6">
        ToolError.rateLimited(
      </text>
      <text
        x="362"
        y="94"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6">
        msg, retryAfterMs?)
      </text>
      {/* retryAfterMs note */}
      <text
        x="352"
        y="140"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.4">
        Supports retryAfterMs delay
      </text>

      {/* ── Card 6: timeout (retryable, highlighted) ──── */}
      {/* Shadow */}
      <rect x="344" y="168" width="200" height="112" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="340"
        y="164"
        width="200"
        height="112"
        fill="var(--color-primary)"
        opacity="0.12"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header strip */}
      <rect x="340" y="164" width="200" height="24" fill="var(--color-foreground)" />
      <text
        x="352"
        y="180"
        fontSize="11"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        timeout
      </text>
      <text
        x="528"
        y="180"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="end">
        Yes
      </text>
      <text
        x="352"
        y="206"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6">
        ToolError.timeout(msg)
      </text>
      {/* transient note */}
      <text
        x="352"
        y="264"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.4">
        Transient network/server issues
      </text>
    </svg>
  </div>
);

/**
 * HowItWorks — horizontal 3-step flow for the Introduction page.
 * Shows the runtime flow: Start MCP server → Extension connects → Agent calls tool.
 */
export const HowItWorks = () => (
  <div className="my-8">
    <svg viewBox="0 0 800 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" aria-hidden="true">
      <defs>
        <marker id="hiw-arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
          <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-foreground)" />
        </marker>
      </defs>

      {/* ── Step 1: Start MCP Server ──────────────────────── */}
      {/* Shadow */}
      <rect x="8" y="18" width="200" height="120" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="4"
        y="14"
        width="200"
        height="120"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="4" y="14" width="200" height="36" fill="var(--color-foreground)" />
      <text
        x="104"
        y="38"
        fontSize="13"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        1. Start Server
      </text>
      {/* Content */}
      <rect x="16" y="64" width="176" height="26" fill="var(--color-foreground)" />
      <text
        x="104"
        y="82"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        opentabs start
      </text>
      <text
        x="104"
        y="118"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Discovers plugins, exposes tools
      </text>

      {/* ── Arrow 1→2 ────────────────────────────────────── */}
      <line
        x1="214"
        y1="74"
        x2="290"
        y2="74"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#hiw-arrow)"
      />

      {/* ── Step 2: Extension Connects (primary-filled) ──── */}
      {/* Shadow */}
      <rect x="308" y="18" width="200" height="120" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="304"
        y="14"
        width="200"
        height="120"
        fill="var(--color-primary)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="304" y="14" width="200" height="36" fill="var(--color-foreground)" />
      <text
        x="404"
        y="38"
        fontSize="13"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        2. Extension Connects
      </text>
      {/* Content */}
      <text
        x="404"
        y="76"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.7"
        textAnchor="middle">
        Injects adapters into
      </text>
      <text
        x="404"
        y="92"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.7"
        textAnchor="middle">
        matching tabs
      </text>
      <text
        x="404"
        y="118"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Your authenticated sessions
      </text>

      {/* ── Arrow 2→3 ────────────────────────────────────── */}
      <line
        x1="514"
        y1="74"
        x2="590"
        y2="74"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#hiw-arrow)"
      />

      {/* ── Step 3: Agent Calls Tool ─────────────────────── */}
      {/* Shadow */}
      <rect x="608" y="18" width="188" height="120" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="604"
        y="14"
        width="188"
        height="120"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="604" y="14" width="188" height="36" fill="var(--color-foreground)" />
      <text
        x="698"
        y="38"
        fontSize="13"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        3. Agent Calls Tool
      </text>
      {/* Content */}
      <rect x="616" y="64" width="164" height="26" fill="var(--color-foreground)" />
      <text
        x="698"
        y="82"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        slack_send_message()
      </text>
      <text
        x="698"
        y="118"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Result flows back to agent
      </text>
    </svg>
  </div>
);

/**
 * InstallPaths — 3-column layout showing the three installation paths
 * (Users, Plugin Developers, Contributors) as parallel options of increasing complexity.
 * Used on the Installation page.
 */
export const InstallPaths = () => (
  <div className="my-8">
    <svg viewBox="0 0 700 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" aria-hidden="true">
      {/* ── Box 1: For Users (highlighted — most common path) ── */}
      {/* Shadow */}
      <rect x="8" y="18" width="200" height="140" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="4"
        y="14"
        width="200"
        height="140"
        fill="var(--color-primary)"
        opacity="0.12"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="4" y="14" width="200" height="36" fill="var(--color-foreground)" />
      <text
        x="104"
        y="38"
        fontSize="13"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        For Users
      </text>
      {/* Content */}
      <rect x="16" y="64" width="176" height="22" fill="var(--color-foreground)" />
      <text
        x="104"
        y="80"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        npm i -g @opentabs-dev/cli
      </text>
      <rect x="16" y="94" width="176" height="22" fill="var(--color-foreground)" />
      <text
        x="104"
        y="110"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        opentabs start
      </text>
      <text
        x="104"
        y="142"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        CLI + Chrome extension
      </text>

      {/* ── Box 2: For Plugin Developers ──────────────────── */}
      {/* Shadow */}
      <rect x="258" y="18" width="200" height="140" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="254"
        y="14"
        width="200"
        height="140"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="254" y="14" width="200" height="36" fill="var(--color-foreground)" />
      <text
        x="354"
        y="38"
        fontSize="13"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        For Developers
      </text>
      {/* Content */}
      <rect x="266" y="64" width="176" height="22" fill="var(--color-foreground)" />
      <text
        x="354"
        y="80"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        + Node.js 22+
      </text>
      <rect x="266" y="94" width="176" height="22" fill="var(--color-foreground)" />
      <text
        x="354"
        y="110"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        create-opentabs-plugin
      </text>
      <text
        x="354"
        y="142"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Users setup + SDK + plugin CLI
      </text>

      {/* ── Box 3: For Contributors ──────────────────────── */}
      {/* Shadow */}
      <rect x="508" y="18" width="188" height="140" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="504"
        y="14"
        width="188"
        height="140"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="504" y="14" width="188" height="36" fill="var(--color-foreground)" />
      <text
        x="598"
        y="38"
        fontSize="13"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        For Contributors
      </text>
      {/* Content */}
      <rect x="516" y="64" width="164" height="22" fill="var(--color-foreground)" />
      <text
        x="598"
        y="80"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        git clone + npm install
      </text>
      <rect x="516" y="94" width="164" height="22" fill="var(--color-foreground)" />
      <text
        x="598"
        y="110"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        npm run build
      </text>
      <text
        x="598"
        y="142"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Full monorepo + all build tools
      </text>
    </svg>
  </div>
);

/**
 * FirstPluginFlow — horizontal 5-step flow for the "Your First Plugin" tutorial.
 * Scaffold → Define Tool → Register → Build → Test, with arrows between steps.
 * The "Build" step uses primary fill since that's where the plugin magic happens.
 */
export const FirstPluginFlow = () => (
  <div className="my-8">
    <svg viewBox="0 0 900 140" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" aria-hidden="true">
      <defs>
        <marker id="fp-arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
          <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-foreground)" />
        </marker>
      </defs>

      {/* ── Step 1: Scaffold ──────────────────────────────── */}
      {/* Shadow */}
      <rect x="4" y="14" width="140" height="110" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="0"
        y="10"
        width="140"
        height="110"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="0" y="10" width="140" height="32" fill="var(--color-foreground)" />
      <text
        x="70"
        y="32"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        1. Scaffold
      </text>
      {/* Content */}
      <rect x="10" y="54" width="120" height="22" fill="var(--color-foreground)" />
      <text
        x="70"
        y="69"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        opentabs plugin create
      </text>
      <text
        x="70"
        y="104"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Standalone npm package
      </text>

      {/* ── Arrow 1→2 ────────────────────────────────────── */}
      <line
        x1="150"
        y1="64"
        x2="190"
        y2="64"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#fp-arrow)"
      />

      {/* ── Step 2: Define Tool ──────────────────────────── */}
      {/* Shadow */}
      <rect x="204" y="14" width="140" height="110" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="200"
        y="10"
        width="140"
        height="110"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="200" y="10" width="140" height="32" fill="var(--color-foreground)" />
      <text
        x="270"
        y="32"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        2. Define Tool
      </text>
      {/* Content */}
      <rect x="210" y="54" width="120" height="22" fill="var(--color-foreground)" />
      <text
        x="270"
        y="69"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        {'defineTool({ ... })'}
      </text>
      <text
        x="270"
        y="104"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Zod schema + handler
      </text>

      {/* ── Arrow 2→3 ────────────────────────────────────── */}
      <line
        x1="350"
        y1="64"
        x2="390"
        y2="64"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#fp-arrow)"
      />

      {/* ── Step 3: Register ─────────────────────────────── */}
      {/* Shadow */}
      <rect x="404" y="14" width="140" height="110" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="400"
        y="10"
        width="140"
        height="110"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="400" y="10" width="140" height="32" fill="var(--color-foreground)" />
      <text
        x="470"
        y="32"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        3. Register
      </text>
      {/* Content */}
      <rect x="410" y="54" width="120" height="22" fill="var(--color-foreground)" />
      <text
        x="470"
        y="69"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        tools: [getPageTitle]
      </text>
      <text
        x="470"
        y="104"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        Plugin class + tools array
      </text>

      {/* ── Arrow 3→4 ────────────────────────────────────── */}
      <line
        x1="550"
        y1="64"
        x2="590"
        y2="64"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#fp-arrow)"
      />

      {/* ── Step 4: Build (primary-filled — the magic step) ── */}
      {/* Shadow */}
      <rect x="604" y="14" width="140" height="110" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="600"
        y="10"
        width="140"
        height="110"
        fill="var(--color-primary)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="600" y="10" width="140" height="32" fill="var(--color-foreground)" />
      <text
        x="670"
        y="32"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        4. Build
      </text>
      {/* Content */}
      <rect x="610" y="54" width="120" height="22" fill="var(--color-foreground)" />
      <text
        x="670"
        y="69"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        textAnchor="middle">
        npm run build
      </text>
      <text
        x="670"
        y="104"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        IIFE + notify server
      </text>

      {/* ── Arrow 4→5 ────────────────────────────────────── */}
      <line
        x1="750"
        y1="64"
        x2="790"
        y2="64"
        stroke="var(--color-foreground)"
        strokeWidth="2"
        markerEnd="url(#fp-arrow)"
      />

      {/* ── Step 5: Test ─────────────────────────────────── */}
      {/* Shadow */}
      <rect x="804" y="14" width="92" height="110" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="800"
        y="10"
        width="92"
        height="110"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="800" y="10" width="92" height="32" fill="var(--color-foreground)" />
      <text
        x="846"
        y="32"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        5. Test
      </text>
      {/* Content */}
      <text
        x="846"
        y="69"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.7"
        textAnchor="middle">
        Ask your
      </text>
      <text
        x="846"
        y="83"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.7"
        textAnchor="middle">
        AI agent
      </text>
      <text
        x="846"
        y="104"
        fontSize="9"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5"
        textAnchor="middle">
        opentabs status
      </text>
    </svg>
  </div>
);

/**
 * PluginStructure — project structure diagram for the Plugin Development guide.
 * Shows the key files in a scaffolded plugin project as a tree.
 */
export const PluginStructure = () => (
  <div className="my-8">
    <svg
      viewBox="0 0 520 340"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-lg"
      aria-hidden="true">
      {/* ── Main box ──────────────────────────────────────── */}
      {/* Shadow */}
      <rect x="8" y="8" width="508" height="328" fill="var(--color-foreground)" />
      {/* Body */}
      <rect
        x="4"
        y="4"
        width="508"
        height="328"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="3"
      />
      {/* Header */}
      <rect x="4" y="4" width="508" height="36" fill="var(--color-foreground)" />
      {/* Traffic lights */}
      <circle cx="24" cy="22" r="5" fill="var(--color-primary)" />
      <circle cx="40" cy="22" r="5" fill="var(--color-background)" opacity="0.4" />
      <circle cx="56" cy="22" r="5" fill="var(--color-background)" opacity="0.4" />
      <text
        x="258"
        y="27"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold"
        textAnchor="middle">
        opentabs-plugin-my-app/
      </text>

      {/* ── File tree ─────────────────────────────────────── */}
      {/* package.json */}
      <text x="28" y="68" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        package.json
      </text>
      <text
        x="220"
        y="68"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        name, opentabs metadata, deps
      </text>

      {/* tsconfig.json */}
      <text x="28" y="94" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        tsconfig.json
      </text>
      <text
        x="220"
        y="94"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        strict, ES2022, ESM
      </text>

      {/* lint and format config */}
      <text
        x="28"
        y="120"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.5">
        eslint.config.ts / .prettierrc
      </text>

      {/* Divider */}
      <line x1="20" y1="138" x2="500" y2="138" stroke="var(--color-foreground)" strokeWidth="1" opacity="0.15" />

      {/* src/ directory */}
      <text
        x="28"
        y="164"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        src/
      </text>

      {/* src/index.ts — plugin class with highlight box */}
      <rect
        x="48"
        y="176"
        width="440"
        height="30"
        fill="var(--color-primary)"
        opacity="0.12"
        stroke="var(--color-foreground)"
        strokeWidth="1.5"
      />
      <text x="62" y="196" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        index.ts
      </text>
      <text
        x="220"
        y="196"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.6">
        Plugin class — name, urlPatterns, isReady()
      </text>

      {/* src/tools/ directory */}
      <text
        x="62"
        y="232"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        tools/
      </text>

      {/* Tool files */}
      <rect x="82" y="244" width="400" height="26" fill="var(--color-foreground)" />
      <text x="96" y="262" fontSize="11" fontFamily="var(--font-mono), monospace" fill="var(--color-primary)">
        get-items.ts
      </text>
      <text
        x="280"
        y="262"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        opacity="0.6">
        {'defineTool({ name, description, input, ... })'}
      </text>

      <rect
        x="82"
        y="278"
        width="400"
        height="26"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="1.5"
      />
      <text x="96" y="296" fontSize="11" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        create-item.ts
      </text>

      <rect
        x="82"
        y="308"
        width="400"
        height="18"
        fill="var(--color-background)"
        stroke="var(--color-foreground)"
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      <text
        x="282"
        y="321"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.4"
        textAnchor="middle">
        one file per tool...
      </text>
    </svg>
  </div>
);
