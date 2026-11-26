import React from 'react';
import { ArrowRight, Check, Layers, MessageSquareText, ShieldCheck, Workflow } from 'lucide-react';
import { KRESNA_ROADMAP } from '../shared/kresna-logic';

interface LandingPageProps {
  onOpenAuth: (mode?: 'login' | 'register') => void;
  onQuickDemo: () => void;
  isDemoLoading: boolean;
}

const HERO_IMAGE = '/src/assets/images/hero_kresna_platform_1795684573118.jpg';

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenAuth,
  onQuickDemo,
  isDemoLoading,
}) => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-8 px-6 py-4">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            KRESNA
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex"
          >
            <a
              href="#capabilities"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900"
            >
              Capabilities
            </a>
            <a
              href="#architecture"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900"
            >
              Architecture
            </a>
            <a
              href="#roadmap"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900"
            >
              Roadmap
            </a>
            <a
              href="#pricing"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900"
            >
              Pricing
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Launch Console
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero Split Section */}
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto grid max-w-[1360px] grid-cols-1 items-stretch gap-10 px-6 py-16 lg:grid-cols-12 lg:py-20">
            <div className="flex flex-col justify-center lg:col-span-6">
              <p className="text-xs font-medium tracking-wide text-blue-700">
                Universal AI Chatbot Platform
              </p>
              <h1 className="mt-4 max-w-2xl text-[clamp(2.25rem,4vw,3.5rem)] font-bold leading-[1.08] tracking-tight text-slate-950 [text-wrap:balance]">
                Natural AI conversations built on your knowledge and APIs.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600">
                Bring your knowledge, connect your APIs, choose your AI model, and publish across channels from one workspace—without writing rigid decision trees or boilerplate plumbing.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => onOpenAuth('register')}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white whitespace-nowrap shrink-0 transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                >
                  Create Your Chatbot
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={onQuickDemo}
                  disabled={isDemoLoading}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-800 whitespace-nowrap shrink-0 transition-colors hover:bg-slate-50 disabled:opacity-60"
                >
                  {isDemoLoading ? 'Opening Demo Workspace...' : 'Explore Demo Workspace'}
                </button>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>Google Gemini Default</span>
                <span aria-hidden="true">·</span>
                <span>Bring Your Own Key (BYOK)</span>
                <span aria-hidden="true">·</span>
                <span>Multi-Tenant Workspaces</span>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-full min-h-[300px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                <img
                  src={HERO_IMAGE}
                  alt="Modular architectural representation of KRESNA multi-source knowledge, model gateway, and channel layers"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* 4-Column Mechanism Strip */}
          <div className="border-t border-slate-200 bg-slate-50/70">
            <div className="mx-auto grid max-w-[1360px] grid-cols-1 divide-y divide-slate-200 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
              <div className="p-6">
                <MessageSquareText className="h-5 w-5 text-blue-700" aria-hidden="true" />
                <h2 className="mt-3 text-sm font-semibold text-slate-900">
                  LLM-Led Reasoning
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  Understands topic switches, informal phrasing, and missing context without hardcoded FAQ flows.
                </p>
              </div>
              <div className="p-6">
                <Layers className="h-5 w-5 text-blue-700" aria-hidden="true" />
                <h2 className="mt-3 text-sm font-semibold text-slate-900">
                  Five-Step Quick Start
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  Name your assistant, attach knowledge, validate Gemini, test in Playground, and publish cleanly.
                </p>
              </div>
              <div className="p-6">
                <Workflow className="h-5 w-5 text-blue-700" aria-hidden="true" />
                <h2 className="mt-3 text-sm font-semibold text-slate-900">
                  Server-Side Model Gateway
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  Encrypted BYOK keys stay on the server with live connection testing and per-model token metering.
                </p>
              </div>
              <div className="p-6">
                <ShieldCheck className="h-5 w-5 text-blue-700" aria-hidden="true" />
                <h2 className="mt-3 text-sm font-semibold text-slate-900">
                  Tenant-Isolated Persistence
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  Every workspace isolates chatbots, conversations, credentials, and usage analytics by tenant.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities Section */}
        <section id="capabilities" className="mx-auto max-w-[1360px] px-6 py-16">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl [text-wrap:balance]">
              Built for business teams first, with full extensibility for engineers.
            </h2>
            <p className="mt-3 text-base text-slate-600">
              Non-technical operators configure assistants in Simple Mode, while developers unlock custom system prompts, API schemas, and isolated extensions in Developer Mode.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="rounded-xl border border-slate-200 bg-white p-7 lg:col-span-7">
              <div className="text-xs font-medium text-slate-500">01. Simple Mode & Developer Mode</div>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">
                Progressive disclosure from preset to custom runtime
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Start with curated role presets—Customer Support, Sales Assistant, Product Advisor, Internal Ops, Technical Support, or Booking Coordinator—and reveal custom prompt directives and token controls only when you need them.
              </p>
              <div className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Simple Mode</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Guided 5-step wizard, recommended Gemini defaults, starter FAQ notes, and live Playground validation.
                  </p>
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">Developer Mode</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Custom system instructions, inspectable execution traces, model parameters, and API connector readiness.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-7 lg:col-span-5">
              <div className="text-xs font-medium text-slate-500">02. Grounded Conversation Evidence</div>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">
                Inspectable responses and real usage telemetry
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Every Playground conversation records exact input/output tokens, response latency, model attribution, and user feedback directly to the database.
              </p>
              <dl className="mt-6 space-y-3 border-t border-slate-100 pt-5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-slate-600">Default Model</dt>
                  <dd className="font-mono text-xs font-medium text-slate-900">gemini-4-hydrogen</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-600">Secret Encryption</dt>
                  <dd className="font-mono text-xs font-medium text-slate-900">AES-256-GCM (Server)</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-600">Workspace Roles</dt>
                  <dd className="font-mono text-xs font-medium text-slate-900">6 RBAC Levels</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* Architecture & Roadmap Section */}
        <section id="architecture" className="border-y border-slate-200 bg-white py-16">
          <div id="roadmap" className="mx-auto max-w-[1360px] px-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-950">
                  Transparent Implementation Roadmap
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-600">
                  Phase 0 and Phase 1 are active and database-backed today. Subsequent phases roll out multi-source RAG, OpenAPI/REST tools, Azure OpenAI, and WhatsApp/Telegram channels cleanly on this foundation.
                </p>
              </div>
              <div className="text-xs text-slate-500 whitespace-nowrap">
                Current Release · Phase 1 Core SaaS Foundation
              </div>
            </div>

            <div className="mt-8 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="px-4 py-3">Phase</th>
                    <th className="px-4 py-3">Milestone</th>
                    <th className="px-4 py-3">Scope</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {KRESNA_ROADMAP.map((row) => (
                    <tr key={row.phase} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                        {row.phase}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                        {row.title}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.summary}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.status === 'tested' || row.status === 'implemented' ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            {row.status === 'tested' ? 'Implemented & Tested' : 'Completed'}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-slate-500">Scheduled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="mx-auto max-w-[1360px] px-6 py-16">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-slate-950">
              Commercial BYOK Tiers
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Connect your own Gemini or enterprise provider keys with predictable workspace limits and zero per-resolution markups.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6">
              <div>
                <div className="text-xs font-medium text-slate-500">For evaluation</div>
                <h3 className="mt-1 text-lg font-bold text-slate-900">Free Trial</h3>
                <div className="mt-3 font-mono text-2xl font-bold text-slate-950 tabular-nums">$0 / mo</div>
                <dl className="mt-5 space-y-2.5 border-t border-slate-100 pt-4 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Chatbots</dt>
                    <dd className="font-mono text-slate-900 tabular-nums">2 bots</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Team seats</dt>
                    <dd className="font-mono text-slate-900 tabular-nums">2 members</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Model billing</dt>
                    <dd className="text-slate-900">BYOK / Managed</dd>
                  </div>
                </dl>
              </div>
              <button
                type="button"
                onClick={() => onOpenAuth('register')}
                className="mt-6 w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
              >
                Start Free Trial
              </button>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-blue-700 bg-white p-6">
              <div>
                <div className="text-xs font-medium text-blue-700">For growing support teams</div>
                <h3 className="mt-1 text-lg font-bold text-slate-900">Starter</h3>
                <div className="mt-3 font-mono text-2xl font-bold text-slate-950 tabular-nums">$49 / mo</div>
                <dl className="mt-5 space-y-2.5 border-t border-slate-100 pt-4 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Chatbots</dt>
                    <dd className="font-mono text-slate-900 tabular-nums">10 bots</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Team seats</dt>
                    <dd className="font-mono text-slate-900 tabular-nums">10 members</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Model billing</dt>
                    <dd className="text-slate-900">Multi-provider BYOK</dd>
                  </div>
                </dl>
              </div>
              <button
                type="button"
                onClick={() => onOpenAuth('register')}
                className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800"
              >
                Create Starter Workspace
              </button>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6">
              <div>
                <div className="text-xs font-medium text-slate-500">For multi-channel operations</div>
                <h3 className="mt-1 text-lg font-bold text-slate-900">Business & Enterprise</h3>
                <div className="mt-3 font-mono text-2xl font-bold text-slate-950 tabular-nums">$199+ / mo</div>
                <dl className="mt-5 space-y-2.5 border-t border-slate-100 pt-4 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Chatbots</dt>
                    <dd className="font-mono text-slate-900 tabular-nums">Unlimited</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">White-label & RBAC</dt>
                    <dd className="text-slate-900">Full 6-role access</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Audit & Isolation</dt>
                    <dd className="text-slate-900">Dedicated policy</dd>
                  </div>
                </dl>
              </div>
              <button
                type="button"
                onClick={onQuickDemo}
                className="mt-6 w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
              >
                Explore Demo Workspace
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1360px] flex-col items-start justify-between gap-4 px-6 py-8 text-xs text-slate-500 sm:flex-row sm:items-center">
          <div className="font-semibold text-slate-900">KRESNA</div>
          <div>Universal AI Chatbot Platform · Multi-Tenant Workspace Architecture</div>
        </div>
      </footer>
    </div>
  );
};
