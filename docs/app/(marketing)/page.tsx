import { SiGithub } from '@icons-pack/react-simple-icons';
import { EyeIcon, FileTextIcon, LockIcon, PackageIcon, ShieldCheckIcon, SparklesIcon } from 'lucide-react';
import Link from 'next/link';
import Footer from '@/components/footer';
import { Button, Text } from '@/components/retroui';

const GITHUB_URL = 'https://github.com/opentabs-dev/opentabs';
const PRDS_URL = 'https://github.com/opentabs-dev/opentabs-prds';

const plugins = [
  { name: 'Slack', tools: 23 },
  { name: 'GitHub', tools: 36 },
  { name: 'Discord', tools: 27 },
  { name: 'Jira', tools: 21 },
  { name: 'Linear', tools: 22 },
  { name: 'Notion', tools: 19 },
  { name: 'GitLab', tools: 23 },
  { name: 'Figma', tools: 15 },
  { name: 'Sentry', tools: 22 },
  { name: 'Confluence', tools: 19 },
  { name: 'Cloudflare', tools: 31 },
  { name: 'Supabase', tools: 27 },
  { name: 'Vercel', tools: 9 },
  { name: 'Asana', tools: 25 },
  { name: 'Airtable', tools: 9 },
  { name: 'Reddit', tools: 15 },
  { name: 'X (Twitter)', tools: 30 },
  { name: 'Teams', tools: 12 },
  { name: 'Bitbucket', tools: 28 },
  { name: 'Stack Overflow', tools: 21 },
];

const steps = [
  {
    step: 1,
    title: 'Your AI sends a tool call',
    description:
      'Claude, Cursor, or any MCP client calls a tool like slack_send_message — just a normal MCP tool call.',
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
      "Every plugin's tools are disabled by default — even the ones we ship. What if our account gets compromised? You shouldn't have to trust us blindly either.",
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
  const totalTools = plugins.reduce((sum, p) => sum + p.tools, 0);

  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────── */}
      <section className="container mx-auto max-w-6xl px-4 pt-14 pb-8 lg:px-0 lg:pt-20 lg:pb-10">
        <div className="mx-auto max-w-3xl text-center">
          <Text as="h1" className="mb-6 text-5xl text-foreground lg:text-6xl">
            Your browser is
            <br />
            already logged in
          </Text>
          <p className="mx-auto mb-4 max-w-xl text-lg text-muted-foreground">
            Most MCP servers ask for your API keys. We thought that was a bit odd. You&apos;re already logged into
            Slack, GitHub, Jira, and a dozen other apps in Chrome.
          </p>
          <p className="mx-auto mb-10 max-w-xl font-medium text-foreground text-lg">Let your AI use them.</p>
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
          </div>
        </div>
      </section>

      {/* ── Install ───────────────────────────────────────── */}
      <section className="container mx-auto max-w-2xl px-4 pb-12 lg:px-0">
        <div className="border-2 border-foreground bg-card p-4 font-mono text-sm">
          <span className="text-muted-foreground">$</span> npm install -g @opentabs-dev/cli && opentabs start
        </div>
      </section>

      {/* ── Plugin Grid ───────────────────────────────────── */}
      <section className="container mx-auto max-w-6xl border-foreground border-t-2 px-4 py-20 lg:px-0">
        <div className="mb-12 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <Text as="h2" className="mb-2 text-3xl">
              {plugins.length} plugins. {totalTools} tools.
            </Text>
            <p className="text-muted-foreground">
              Each one talks to the real web app through your authenticated session.
            </p>
          </div>
          <p className="text-muted-foreground text-sm">
            Plus <strong className="text-foreground">built-in browser tools</strong> for any tab.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {plugins.map(plugin => (
            <div
              key={plugin.name}
              className="flex items-center justify-between border-2 border-foreground px-4 py-3 text-sm transition-colors hover:bg-primary/10">
              <span className="font-medium text-foreground">{plugin.name}</span>
              <span className="text-muted-foreground">{plugin.tools}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ──────────────────────────────────── */}
      <section className="container mx-auto max-w-6xl border-foreground border-t-2 px-4 py-20 lg:px-0">
        <Text as="h2" className="mb-4 text-3xl">
          How it works
        </Text>
        <p className="mb-12 max-w-xl text-muted-foreground">
          OpenTabs is a Chrome extension and MCP server. Your AI agent sends a tool call, we route it to the right
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
          {/* Let AI build it */}
          <div className="border-4 border-foreground p-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center border-2 border-foreground bg-primary">
              <SparklesIcon size={24} />
            </div>
            <Text as="h3" className="mb-3 text-xl">
              Let your AI build it
            </Text>
            <p className="mb-4 text-muted-foreground text-sm leading-relaxed">
              Point your AI at any website. It analyzes the page, discovers the APIs, scaffolds a plugin, writes the
              tools, and registers it. Every line of code is yours to review.
            </p>
            <p className="mb-4 text-muted-foreground text-sm leading-relaxed">
              Fun fact: many of the plugins in this repo were built by AI in under five minutes. The MCP server ships
              with site analysis tools, the SDK handles the boilerplate, and a self-improving skill teaches AI agents
              the entire process. Every time an agent builds a plugin, it writes what it learned back into the skill —
              so the system gets better with every plugin built.
            </p>
            <p className="mb-6 text-muted-foreground text-sm leading-relaxed">
              We think this is actually safer than installing someone else&apos;s code — your agent wrote it, you can
              read every line, and it runs in your browser.
            </p>
            <Link href="/docs/guides/plugin-development" className="font-medium text-sm underline underline-offset-4">
              Learn more
            </Link>
          </div>

          {/* Install pre-built */}
          <div className="border-4 border-foreground p-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center border-2 border-foreground bg-primary">
              <PackageIcon size={24} />
            </div>
            <Text as="h3" className="mb-3 text-xl">
              Install pre-built
            </Text>
            <p className="mb-6 text-muted-foreground text-sm leading-relaxed">
              {plugins.length} plugins ready to go. Install globally and they&apos;re auto-discovered by the server. Or
              build your own by hand with the Plugin SDK and publish to npm.
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
            Security, for real
          </Text>
          <p className="text-muted-foreground">
            We know you&apos;re the kind of person who sets{' '}
            <code className="bg-inline-code-bg px-1.5 py-0.5 text-sm">DANGEROUSLY_SKIP_PERMISSIONS=1</code> the moment
            something asks for confirmation. We respect your courage. But your browser sessions are precious, and we
            still wanted the defaults to be thoughtful — even for the fearless among us.
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
            <p className="mb-3 font-bold text-foreground">
              Why not just use the official MCP server for Slack / GitHub / etc.?
            </p>
            <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
              If an official MCP server works well for you, absolutely use it. We started building OpenTabs for apps
              that don&apos;t ship official MCP support — Discord, Figma, Linear, and many others had nothing when we
              began. Along the way, we noticed that setting up separate API keys for each service adds up when you use
              ten of them, and the web app often has access to more features than the public API exposes. We see
              OpenTabs and official servers as complementary — use whatever works best, or mix and match.
            </p>
          </div>
          <div>
            <p className="mb-3 font-bold text-foreground">How is this different from browser automation tools?</p>
            <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
              Tools like Playwright MCP, Stagehand, and Browser-Use are great — they work on any site out of the box by
              navigating the page visually. The difference is that whatever the AI figures out during a session is gone
              afterward. There&apos;s no way to share or reuse that knowledge. OpenTabs plugins call internal APIs
              directly, so once a plugin is built, it&apos;s a structured, typed package anyone can install. The
              knowledge accumulates — every plugin built makes the platform more useful for everyone.
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
              is a proposal where websites expose structured MCP tools natively. We think it&apos;s a great idea —
              it&apos;s how the web should probably work long-term. The timeline depends on adoption, though. OpenTabs
              works right now, in about five minutes. When WebMCP is widespread, OpenTabs plugins can evolve to use it.
            </p>
          </div>
          <div>
            <p className="mb-3 font-bold text-foreground">Can I build a plugin for Google Docs?</p>
            <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
              We&apos;ll be honest: we burned a lot of tokens trying and couldn&apos;t crack it. Google did a genuinely
              impressive job obscuring their internal APIs — hats off to them. If you manage to figure it out and want
              to contribute a Google Workspace plugin back, you&apos;d be our hero.
            </p>
          </div>
        </div>
      </section>

      {/* ── How This Was Built ────────────────────────────── */}
      <section className="container mx-auto max-w-6xl border-foreground border-t-2 px-4 py-20 lg:px-0">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div>
            <Text as="h2" className="mb-4 text-3xl">
              How this was built
            </Text>
            <p className="mb-4 text-muted-foreground leading-relaxed">
              This might sound a little wild: OpenTabs was built entirely by AI agents. 568 structured PRDs, executed
              over 19 days by up to 6 parallel Claude Code workers running in Docker containers.
            </p>
            <p className="mb-6 text-muted-foreground leading-relaxed">
              The work queue is just git — <code className="bg-inline-code-bg px-1.5 py-0.5 text-sm">git push</code>{' '}
              serialization acts as a distributed lock. No Redis, no SQS. We open-sourced every single PRD.
            </p>
            <Link href={PRDS_URL} target="_blank" className="font-medium text-sm underline underline-offset-4">
              Browse the 568 PRDs
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { number: '568', label: 'PRDs executed' },
              { number: '19', label: 'days' },
              { number: '6', label: 'parallel workers' },
              { number: '0', label: 'hand-written lines' },
            ].map(stat => (
              <div key={stat.label} className="border-2 border-foreground p-6 text-center">
                <p className="font-head text-3xl text-foreground lg:text-4xl">{stat.number}</p>
                <p className="mt-1 text-muted-foreground text-sm">{stat.label}</p>
              </div>
            ))}
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
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
