import { SiDiscord, SiGithub } from '@icons-pack/react-simple-icons';
import {
  BotIcon,
  CloudIcon,
  CreditCardIcon,
  EyeIcon,
  FileTextIcon,
  FigmaIcon,
  GitBranchIcon,
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
  TrelloIcon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import Footer from '@/components/footer';
import { Button, Text } from '@/components/retroui';

const DISCORD_URL = 'https://discord.com/channels/1477900943524888789';
const GITHUB_URL = 'https://github.com/opentabs-dev/opentabs';

interface PluginShowcase {
  name: string;
  icon: LucideIcon;
}

const plugins: PluginShowcase[] = [
  { name: 'Slack', icon: MessageSquareIcon },
  { name: 'Discord', icon: BotIcon },
  { name: 'GitHub', icon: GitBranchIcon },
  { name: 'Jira', icon: TrelloIcon },
  { name: 'Notion', icon: FileTextIcon },
  { name: 'Figma', icon: FigmaIcon },
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
      'The plugin adapter executes the action in the page using your logged-in session. Results flow back to the agent.',
  },
];

const securityPoints = [
  {
    icon: LockIcon,
    title: 'Everything starts off',
    description:
      "Every plugin's tools are disabled by default — even the ones I ship. What if my account gets compromised? You shouldn't have to trust me blindly either.",
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
    description: 'Every tool call is logged — what ran, when, whether it succeeded. On disk and in memory.',
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
          <p className="mx-auto mb-4 max-w-xl font-bold text-foreground text-base">
            This is not another Playwright wrapper.
          </p>
          <p className="mx-auto mb-10 max-w-xl text-muted-foreground text-sm leading-relaxed">
            Chrome&apos;s{' '}
            <Link
              href="https://developer.chrome.com/blog/webmcp-epp"
              target="_blank"
              className="underline underline-offset-4">
              WebMCP
            </Link>{' '}
            wants websites to expose structured tools to AI agents, but that requires every service to opt in — and it
            will take years. OpenTabs doesn&apos;t wait. We reverse-engineered the internal APIs that web apps already
            use and exposed them as MCP tools today. Your AI calls the same backend the frontend calls — through your
            browser, using your existing session. No screenshots. No DOM. No guessing.
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

      {/* ── Two Ways to Get Plugins ───────────────────────── */}
      <section className="container mx-auto max-w-6xl border-foreground border-t-2 px-4 py-20 lg:px-0">
        <Text as="h2" className="mb-12 text-3xl">
          Two ways to get plugins
        </Text>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Contribute */}
          <div className="border-4 border-foreground p-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center border-2 border-foreground bg-primary">
              <SparklesIcon size={24} />
            </div>
            <Text as="h3" className="mb-3 text-xl">
              Contribute a plugin
            </Text>
            <p className="mb-4 text-muted-foreground text-sm leading-relaxed">
              Point your AI at any website. It analyzes the page, discovers the APIs, scaffolds a plugin, writes the
              tools, and registers it. Publish it and anyone can install it — the knowledge accumulates, and every
              plugin contributed makes OpenTabs more useful for everyone.
            </p>
            <p className="mb-4 text-muted-foreground text-sm leading-relaxed">
              Most of the plugins in this repo were built by AI in minutes. The MCP server ships with site analysis
              tools, the SDK handles the boilerplate, and a self-improving skill teaches AI agents the entire process.
              Every time an agent builds a plugin, it writes what it learned back into the skill — so the system gets
              better with every plugin built.
            </p>
            <p className="mb-6 text-muted-foreground text-sm leading-relaxed">
              For internal tools or sensitive workflows, you can keep plugins local — they work the same way, they just
              stay on your machine.
            </p>
            <Link href="/docs/guides/plugin-development" className="font-medium text-sm underline underline-offset-4">
              Learn more
            </Link>
          </div>

          {/* Install */}
          <div className="border-4 border-foreground p-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center border-2 border-foreground bg-primary">
              <PackageIcon size={24} />
            </div>
            <Text as="h3" className="mb-3 text-xl">
              Install community plugins
            </Text>
            <p className="mb-6 text-muted-foreground text-sm leading-relaxed">
              100+ plugins ready to go — built and shared by the community. Install globally and they&apos;re
              auto-discovered by the server.
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
            Permissions and defaults
          </Text>
          <p className="text-muted-foreground">
            I know you&apos;re the kind of person who sets{' '}
            <code className="bg-inline-code-bg px-1.5 py-0.5 text-sm">DANGEROUSLY_SKIP_PERMISSIONS=1</code> the moment
            something asks for confirmation. I respect that. But your browser sessions are precious, so I wanted the
            defaults to be thoughtful — even for the fearless.
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
          Everything runs locally. No cloud. No telemetry. The code is open source —{' '}
          <Link href={GITHUB_URL} target="_blank" className="underline underline-offset-4">
            read it
          </Link>
          .
        </p>
      </section>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <section className="container mx-auto max-w-6xl border-foreground border-t-2 px-4 py-20 lg:px-0">
        <Text as="h2" className="mb-12 text-3xl">
          Questions you&apos;re probably thinking
        </Text>
        <div className="space-y-10">
          <div>
            <p className="mb-3 font-bold text-foreground">Why not just use official MCP servers?</p>
            <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
              If an official MCP server works well for you, use it. I started building OpenTabs for the apps that
              don&apos;t have MCP support — many had none when I began, and some probably never will. Along the way, I
              also built plugins for apps that do have official servers, partly for learning, partly because I noticed a
              few things: setting up separate API keys or OAuth flows for each service adds up when you use a dozen of
              them. Public APIs sometimes have stricter rate limits or a smaller feature set than the web app. And the
              web app is always the superset — internal APIs, real-time data, features that never make it to the public
              API. I see OpenTabs and official servers as complementary — use whatever fits, or mix and match.
            </p>
          </div>
          <div>
            <p className="mb-3 font-bold text-foreground">
              How is this different from browser automation (Playwright, Stagehand, Browser-Use)?
            </p>
            <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
              Those are great tools. Both approaches have real strengths, and I want to be honest about the tradeoffs.
              Browser automation simulates what a human would do — click, type, read the screen. It works on any site
              out of the box, and that&apos;s a real advantage. The cost is speed, tokens, and the knowledge stays
              trapped in that one session. If a popup appears or the layout changes, the AI figures it out again from
              scratch. OpenTabs plugins call the web app&apos;s internal APIs directly. A send-message tool isn&apos;t
              clicking a text box — it&apos;s making the same API call the web app&apos;s frontend makes. Fast, cheap on
              tokens, and the knowledge is packaged into a reusable plugin. The downside is you need a plugin per site,
              and internal APIs can change. If a plugin breaks, open a PR — I want to keep everything working.
            </p>
          </div>
          <div>
            <p className="mb-3 font-bold text-foreground">What about Chrome&apos;s WebMCP?</p>
            <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
              <Link
                href="https://developer.chrome.com/blog/webmcp-epp"
                target="_blank"
                className="underline underline-offset-4">
                Chrome&apos;s WebMCP
              </Link>{' '}
              is the reactive version of the same idea — websites opt in and expose structured tools to AI agents
              natively. I think it&apos;s the right long-term direction. But adoption depends on every web service
              choosing to participate, deciding which features to expose, and rolling it out. That takes years, and even
              then you&apos;re limited to what each service decides to surface. OpenTabs is the proactive version.
              Instead of waiting, we reverse-engineer the APIs and expose them today. If WebMCP becomes widespread,
              OpenTabs plugins can evolve to use it — but you don&apos;t have to wait.
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
