import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import Link from 'next/link';
import { Button } from '@/components/retroui/Button';

const features = [
  {
    icon: '🔌',
    title: 'Plugin Architecture',
    description:
      'Anyone can publish an OpenTabs plugin as a standalone npm package. Discover and install plugins with a single command.',
  },
  {
    icon: '🤖',
    title: 'AI Agent Ready',
    description: 'Connects directly to Claude, Cursor, and any MCP-compatible AI agent. No custom integrations needed.',
  },
  {
    icon: '🔒',
    title: 'Zero Trust Access',
    description:
      'All traffic flows through your authenticated browser session. No tokens shared with third-party servers.',
  },
  {
    icon: '⚡',
    title: 'Hot Reload',
    description: 'Changes to plugins and server code apply instantly via Bun hot reload — no restarts, no downtime.',
  },
  {
    icon: '🌐',
    title: 'Any Web App',
    description: 'Works with any website you can open in Chrome — Slack, GitHub, Jira, Linear, and thousands more.',
  },
  {
    icon: '🛠️',
    title: 'Plugin SDK',
    description:
      'Build your own tools with the Plugin SDK. Define tools with Zod schemas and ship an adapter in minutes.',
  },
];

export default function HomePage() {
  return (
    <HomeLayout
      {...baseOptions}
      nav={{
        ...baseOptions.nav,
        component: undefined,
      }}>
      {/* Hero */}
      <section className="border-border bg-background border-b-2 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-5xl">
          <div className="border-border bg-primary mb-4 inline-flex items-center gap-2 border-2 px-3 py-1 font-sans text-sm font-semibold">
            Now in beta
          </div>
          <h1 className="font-head mb-6 text-5xl leading-tight font-bold md:text-7xl">
            AI agents for
            <br />
            <span className="bg-primary px-2">any web app</span>
          </h1>
          <p className="text-muted-foreground mb-8 max-w-2xl font-sans text-lg md:text-xl">
            OpenTabs gives AI agents access to any web application through your authenticated browser session — no API
            integrations, no new credentials, no changes to the app.
          </p>
          <div className="flex flex-wrap gap-4">
            <Button asChild variant="default" size="lg">
              <Link href="/docs/guides/installation">Get Started</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/docs">Read the Docs</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-border bg-background border-b-2 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-head mb-2 text-3xl font-semibold">Everything you need</h2>
          <p className="text-muted-foreground mb-10 font-sans">A complete platform for AI-powered web automation.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(feature => (
              <div
                key={feature.title}
                className="border-border bg-card flex flex-col gap-3 border-2 p-5 shadow-md transition-all hover:translate-y-0.5 hover:shadow">
                <div className="text-3xl">{feature.icon}</div>
                <h3 className="font-head text-lg font-medium">{feature.title}</h3>
                <p className="text-muted-foreground font-sans text-sm">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-border bg-muted/30 border-b-2 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-head mb-10 text-3xl font-semibold">How it works</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Install & configure',
                desc: 'Clone the repo, run bun install, and load the Chrome extension. Takes under 5 minutes.',
              },
              {
                step: '02',
                title: 'Connect your agent',
                desc: 'Point your AI agent at the MCP server endpoint. Start using pre-built or custom tools instantly.',
              },
              {
                step: '03',
                title: 'Build plugins',
                desc: 'Use the Plugin SDK to define new tools for any website. Publish as an npm package for the community.',
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="border-border bg-card border-2 p-5 shadow-md">
                <div className="font-head border-border bg-primary mb-3 inline-flex size-10 items-center justify-center border-2 text-lg font-bold">
                  {step}
                </div>
                <h3 className="font-head mb-2 text-lg font-medium">{title}</h3>
                <p className="text-muted-foreground font-sans text-sm">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="font-head mb-4 text-3xl font-semibold">Ready to get started?</h2>
          <p className="text-muted-foreground mb-8 font-sans">
            Set up OpenTabs in minutes and start building AI-powered automations today.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button asChild variant="default" size="lg">
              <Link href="/docs/guides/installation">Installation Guide</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/docs/components">View Components</Link>
            </Button>
          </div>
        </div>
      </section>
    </HomeLayout>
  );
}
