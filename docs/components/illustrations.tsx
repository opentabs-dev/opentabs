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

      {/* auth.json */}
      <text x="28" y="94" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        auth.json
      </text>
      <text
        x="220"
        y="94"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Auth secret + port (written on server start)
      </text>

      {/* audit.log */}
      <text x="28" y="120" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        audit.log
      </text>
      <text
        x="220"
        y="120"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Tool invocation log (NDJSON, append-only)
      </text>

      {/* server.log */}
      <text x="28" y="146" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        server.log
      </text>
      <text
        x="220"
        y="146"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Server output (written by opentabs start)
      </text>

      {/* Divider */}
      <line x1="20" y1="162" x2="500" y2="162" stroke="var(--color-foreground)" strokeWidth="1" opacity="0.15" />

      {/* extension/ directory */}
      <text
        x="28"
        y="186"
        fontSize="12"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-primary)"
        fontWeight="bold">
        extension/
      </text>
      <text
        x="220"
        y="186"
        fontSize="10"
        fontFamily="var(--font-mono), monospace"
        fill="var(--color-foreground)"
        opacity="0.45">
        Chrome extension (managed by opentabs start)
      </text>

      {/* extension/manifest.json */}
      <text x="62" y="212" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        manifest.json
      </text>

      {/* extension/background.js */}
      <text x="62" y="238" fontSize="12" fontFamily="var(--font-mono), monospace" fill="var(--color-foreground)">
        background.js
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
        Core platform packages (bun workspaces)
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
        platform/ linked via Bun workspaces · plugins/ are standalone
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
        {'defineTool({ name, input, output, handle })'}
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
