import { SiDiscord, SiGithub } from '@icons-pack/react-simple-icons';
import {
  BotIcon,
  CloudIcon,
  CreditCardIcon,
  EyeIcon,
  FileTextIcon,
  FrameIcon,
  GitBranchIcon,
  KanbanIcon,
  LayoutDashboardIcon,
  LockIcon,
  MessageSquareIcon,
  MusicIcon,
  PackageIcon,
  PlaneIcon,
  PlayIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  SparklesIcon,
  TerminalIcon,
  TrendingUpIcon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import Footer from '@/components/footer';
import { Button, Text } from '@/components/retroui';

const DISCORD_URL = 'https://discord.gg/b8Hjpz4B';
const GITHUB_URL = 'https://github.com/opentabs-dev/opentabs';

interface PluginShowcase {
  name: string;
  icon: LucideIcon;
}

const plugins: PluginShowcase[] = [
  { name: 'Slack', icon: MessageSquareIcon },
  { name: 'Discord', icon: BotIcon },
  { name: 'GitHub', icon: GitBranchIcon },
  { name: 'Jira', icon: KanbanIcon },
  { name: 'Notion', icon: FileTextIcon },
  { name: 'Figma', icon: FrameIcon },
  { name: 'AWS', icon: CloudIcon },
  { name: 'Stripe', icon: CreditCardIcon },
  { name: 'Robinhood', icon: TrendingUpIcon },
  { name: 'Netflix', icon: PlayIcon },
  { name: 'Airbnb', icon: PlaneIcon },
  { name: 'Spotify', icon: MusicIcon },
  { name: 'DoorDash', icon: ShoppingCartIcon },
  { name: 'Linear', icon: LayoutDashboardIcon },
];

const steps = [
  {
    step: 1,
    title: 'Your AI sends a tool call',
    description:
      'Claude, Cursor, or any MCP client calls a tool like discord_send_message — just a normal MCP tool call.',
  },
  {
    step: 2,
    title: 'OpenTabs routes it to the right tab',
    description: 'The MCP server finds the matching browser tab and dispatches the call through the Chrome extension.',
  },
  {
    step: 3,
    title: 'It runs on the real web app',
    description:
      'The plugin calls the same internal API the frontend calls, using your logged-in session. Results flow back to the agent.',
  },
];

const securityPoints = [
  {
    icon: LockIcon,
    title: 'Everything starts off',
    description:
      "Every plugin's tools are disabled by default — even the ones I ship. You shouldn't have to trust me blindly.",
  },
  {
    icon: EyeIcon,
    title: 'AI-assisted code review',
    description:
      'When you enable a plugin, your AI can review the adapter source code first. You see the findings and decide.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Version-aware',
    description: 'When a plugin updates, permissions reset. New code, new review.',
  },
  {
    icon: FileTextIcon,
    title: 'Full audit log',
    description: 'Every tool call is logged — what ran, when, whether it succeeded.',
  },
];

export default function Home() {
  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────── */}
      <section className="container mx-auto max-w-6xl px-4 pt-14 pb-8 lg:px-0 lg:pt-20 lg:pb-10">
        <div className="mx-auto max-w-3xl text-center">
          <Text as="h1" className="mb-6 text-5xl text-foreground lg:text-6xl">
            Every web app
            <br />
            is an API
          </Text>
          <p className="mx-auto mb-10 max-w-xl text-muted-foreground text-sm leading-relaxed">
            Web apps already have internal APIs — the same ones their frontends use. OpenTabs reverse-engineered them
            and exposed them as{' '}
            <Link href="https://modelcontextprotocol.io/" target="_blank" className="underline underline-offset-4">
              MCP tools
            </Link>{' '}
            today. Your AI calls the same backend the frontend calls — through your browser, using your existing
            session. No screenshots. No DOM. No guessing.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/docs/quick-start" passHref>
              <Button>Get Started</Button>
            </Link>
            <Link href={GITHUB_URL} target="_blank" passHref>
              <Button variant="outline">
                <SiGithub size={16} className="mr-2" />
                GitHub
              </Button>
            </Link>
            <Link href={DISCORD_URL} target="_blank" passHref>
              <Button variant="outline">
                <SiDiscord size={16} className="mr-2" />
                Discord
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Install ───────────────────────────────────────── */}
      <section className="container mx-auto max-w-2xl px-4 pb-12 lg:px-0">
        <div className="border-2 border-foreground bg-card p-4 font-mono text-sm">
          <span className="text-muted-foreground">$</span> npm install -g @opentabs-dev/cli && opentabs start
        </div>
      </section>

      {/* ── Works With ─────────────────────────────────────── */}
      <section className="container mx-auto max-w-2xl px-4 pb-16 lg:px-0">
        <p className="mb-4 text-center text-muted-foreground text-xs uppercase tracking-widest">Works with</p>
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {[
            { name: 'Claude Code', href: 'https://github.com/anthropics/claude-code' },
            { name: 'Cursor', href: 'https://cursor.com' },
            { name: 'Windsurf', href: 'https://windsurf.com' },
            { name: 'OpenCode', href: 'https://github.com/anomalyco/opencode' },
          ].map(client => (
            <a
              key={client.name}
              href={client.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground">
              <TerminalIcon size={14} />
              <span>{client.name}</span>
            </a>
          ))}
        </div>
        <p className="mt-3 text-center text-muted-foreground text-xs">
          And any MCP client that supports Streamable HTTP.
        </p>
      </section>

      {/* ── Plugin Grid ───────────────────────────────────── */}
      <section className="container mx-auto max-w-6xl border-foreground border-t-2 px-4 py-20 lg:px-0">
        <div className="mb-12 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <Text as="h2" className="mb-2 text-3xl">
              100+ plugins. ~2,000 tools.
            </Text>
            <p className="text-muted-foreground">
              Each one talks to the real web app through your authenticated session.
            </p>
          </div>
          <p className="text-muted-foreground text-sm">
            Plus <strong className="text-foreground">built-in browser tools</strong> for any tab.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
          {plugins.map(plugin => (
            <div
              key={plugin.name}
              className="flex flex-col items-center gap-2 border-2 border-foreground px-4 py-4 text-sm transition-colors hover:bg-primary/10">
              <plugin.icon size={20} className="text-muted-foreground" />
              <span className="font-medium text-foreground">{plugin.name}</span>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-muted-foreground text-sm">
          And 90+ more — messaging, DevOps, finance, shopping, streaming, and beyond.{' '}
          <Link href={`${GITHUB_URL}/tree/main/plugins`} target="_blank" className="underline underline-offset-4">
            Browse all plugins
          </Link>
        </p>
      </section>

      {/* ── How It Works ──────────────────────────────────── */}
      <section className="container mx-auto max-w-6xl border-foreground border-t-2 px-4 py-20 lg:px-0">
        <Text as="h2" className="mb-4 text-3xl">
          How it works
        </Text>
        <p className="mb-12 max-w-xl text-muted-foreground">
          OpenTabs is a Chrome extension and MCP server. Your AI agent sends a tool call, it gets routed to the right
          browser tab, and the action happens on the real web app.
        </p>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {steps.map(item => (
            <div key={item.step} className="flex gap-5">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center border-2 border-foreground bg-primary font-bold text-foreground text-sm">
                {item.step}
              </span>
              <div>
                <p className="mb-2 font-bold text-foreground">{item.title}</p>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Build or Install ──────────────────────────────── */}
      <section className="container mx-auto max-w-6xl border-foreground border-t-2 px-4 py-20 lg:px-0">
        <Text as="h2" className="mb-12 text-3xl">
          Get plugins
        </Text>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Build */}
          <div className="border-4 border-foreground p-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center border-2 border-foreground bg-primary">
              <SparklesIcon size={24} />
            </div>
            <Text as="h3" className="mb-3 text-xl">
              Point your AI at any website
            </Text>
            <p className="mb-4 text-muted-foreground text-sm leading-relaxed">
              It analyzes the page, discovers the APIs, scaffolds the code, and registers the plugin. Most of the
              plugins in this repo were built by AI in minutes.
            </p>
            <p className="mb-6 text-muted-foreground text-sm leading-relaxed">
              A{' '}
              <Link
                href={`${GITHUB_URL}/tree/main/.claude/skills/build-plugin`}
                target="_blank"
                className="underline underline-offset-4">
                self-improving skill
              </Link>{' '}
              teaches AI agents the process — and gets better with every plugin built. Publish yours or keep it local
              for internal tools.
            </p>
            <Link href="/docs/guides/plugin-development" className="font-medium text-sm underline underline-offset-4">
              Plugin development guide
            </Link>
          </div>

          {/* Install */}
          <div className="border-4 border-foreground p-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center border-2 border-foreground bg-primary">
              <PackageIcon size={24} />
            </div>
            <Text as="h3" className="mb-3 text-xl">
              Install from npm
            </Text>
            <p className="mb-6 text-muted-foreground text-sm leading-relaxed">
              100+ plugins ready to go. Install globally and the server picks them up automatically.
            </p>
            <div className="mb-6 border-2 border-foreground bg-card p-3 font-mono text-sm">
              <span className="text-muted-foreground">$</span> opentabs plugin install slack
            </div>
            <Link href="/docs/quick-start" className="font-medium text-sm underline underline-offset-4">
              Quick start
            </Link>
          </div>
        </div>
      </section>

      {/* ── Security ──────────────────────────────────────── */}
      <section className="container mx-auto max-w-6xl border-foreground border-t-2 px-4 py-20 lg:px-0">
        <div className="mb-12 max-w-xl">
          <Text as="h2" className="mb-4 text-3xl">
            Safe by default
          </Text>
          <p className="text-muted-foreground">
            Your browser sessions are precious. Everything is off until you turn it on — and you control exactly how
            much trust to give each plugin.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {securityPoints.map(point => (
            <div key={point.title} className="flex gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center border-2 border-foreground">
                <point.icon size={18} />
              </div>
              <div>
                <p className="mb-1 font-bold text-foreground text-sm">{point.title}</p>
                <p className="text-muted-foreground text-sm leading-relaxed">{point.description}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-8 text-muted-foreground text-sm">
          Runs locally. No cloud. No telemetry. The code is open source —{' '}
          <Link href={GITHUB_URL} target="_blank" className="underline underline-offset-4">
            read it
          </Link>
          .
        </p>
      </section>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <section className="container mx-auto max-w-6xl border-foreground border-t-2 px-4 py-20 lg:px-0">
        <Text as="h2" className="mb-12 text-3xl">
          FAQ
        </Text>
        <div className="space-y-10">
          <div>
            <p className="mb-3 font-bold text-foreground">
              How is this different from browser automation (Playwright, Stagehand, Browser-Use)?
            </p>
            <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
              Browser automation simulates what a human would do — click, type, read the screen. Works on any site out
              of the box, but the cost is speed, tokens, and the knowledge stays trapped in that one session. OpenTabs
              plugins call the web app&apos;s internal APIs directly. A send-message tool isn&apos;t clicking a text box
              — it&apos;s making the same API call the frontend makes. Fast, cheap on tokens, and the knowledge is
              packaged into a reusable plugin. The tradeoff is you need a plugin per site, and internal APIs can change.
            </p>
          </div>
          <div>
            <p className="mb-3 font-bold text-foreground">What about Chrome&apos;s WebMCP?</p>
            <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
              <Link
                href="https://developer.chrome.com/blog/webmcp-epp"
                target="_blank"
                className="underline underline-offset-4">
                WebMCP
              </Link>{' '}
              is the right long-term direction — websites opt in and expose tools to AI agents natively. But adoption
              depends on every service choosing to participate, and that takes years. OpenTabs is the proactive version:
              reverse-engineer the APIs and expose them today. If WebMCP becomes widespread, plugins can evolve to use
              it.
            </p>
          </div>
          <div>
            <p className="mb-3 font-bold text-foreground">2,000 tools? Won&apos;t that blow up my context window?</p>
            <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
              No. OpenTabs has three connection modes — pick the one that fits.{' '}
              <strong className="text-foreground">Full MCP</strong> gives you everything upfront.{' '}
              <strong className="text-foreground">Gateway</strong> exposes 2 meta-tools and lets your AI discover the
              rest on demand. <strong className="text-foreground">CLI mode</strong> has zero MCP overhead — your AI just
              calls <code className="bg-card px-1 py-0.5 text-xs">opentabs tool call</code> via shell. Most users enable
              3–5 plugins and only those tools load into context.{' '}
              <Link href="/docs/reference/mcp-server#connection-modes" className="underline underline-offset-4">
                Learn more
              </Link>
            </p>
          </div>
          <div>
            <p className="mb-3 font-bold text-foreground">Why not just use official MCP servers?</p>
            <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
              If one works well for you, use it. OpenTabs started for apps that don&apos;t have MCP support. Along the
              way, I noticed: setting up separate API keys for each service adds up, public APIs sometimes have stricter
              rate limits, and the web app is always the superset. I see OpenTabs and official servers as complementary
              — mix and match.
            </p>
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────── */}
      <section className="container mx-auto my-24 max-w-6xl px-4 lg:px-0">
        <div className="flex flex-col items-center justify-between gap-8 border-4 border-foreground bg-primary px-8 py-14 lg:flex-row">
          <div>
            <Text as="h2" className="mb-2 text-foreground">
              Ready to try it?
            </Text>
            <p className="text-foreground/70">
              Five minutes from install to your first tool call. Open source. MIT licensed.
            </p>
          </div>
          <div className="flex flex-shrink-0 flex-col gap-4 sm:flex-row">
            <Link href="/docs/quick-start" passHref>
              <Button className="bg-background" variant="outline">
                Quick Start
              </Button>
            </Link>
            <Link href={GITHUB_URL} target="_blank" passHref>
              <Button className="bg-background" variant="outline">
                <SiGithub size={16} className="mr-2" />
                View on GitHub
              </Button>
            </Link>
            <Link href={DISCORD_URL} target="_blank" passHref>
              <Button className="bg-background" variant="outline">
                <SiDiscord size={16} className="mr-2" />
                Join Discord
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
