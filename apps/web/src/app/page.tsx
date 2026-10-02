import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { Section, SectionHeader } from "@/components/ui";
import { Hero } from "@/components/landing/hero";
import { Integrations } from "@/components/landing/integrations";
import { Problem } from "@/components/landing/problem";
import { RiskDemo } from "@/components/landing/risk-demo";
import { RolloutDemo } from "@/components/landing/rollout-demo";
import { Terminal } from "@/components/landing/terminal";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ConsoleShowcase } from "@/components/landing/console-showcase";
import { Compare, FAQ, FinalCTA, Footer, Pricing, Trust } from "@/components/landing/sections";
import { RevealObserver } from "@/components/landing/motion";
import { CliFacts } from "@/components/landing/cli-facts";
import "@/components/landing/landing.css";

const description =
  "Alror scores every pull request for risk, sizes the canary to match, verifies each stage against live metrics and rolls back automatically. Open-source CLI, GitHub Actions, Kubernetes and ECS.";

export const metadata: Metadata = {
  title: "Alror: ship every change at the speed of AI, safely",
  description,
  openGraph: {
    title: "Alror: ship every change at the speed of AI, safely",
    description,
    type: "website",
    siteName: "Alror",
  },
  twitter: {
    card: "summary_large_image",
    title: "Alror: ship every change at the speed of AI, safely",
    description,
  },
};

export default function Home() {
  return (
    <div className="lp flex min-h-full flex-1 flex-col">
      <RevealObserver />
      <Navbar />
      <main id="main" className="flex-1">
        <Hero />
        <Integrations />
        <Problem />

        <Section id="risk" label="Risk scoring">
          <SectionHeader
            eyebrow="02 · Change risk"
            title="Every pull request gets a score."
            muted="The score sets the rollout."
            lead="Alror reads the diff and scores it from 0 to 100 with named, auditable factors. Pick a pull request below, then change what it touches and watch the plan change with it."
          />
          <RiskDemo />
        </Section>

        <Section id="verify" label="Verification and rollback">
          <SectionHeader
            eyebrow="03 · Verification"
            title="Every stage is verified."
            muted="Regressions roll back on their own."
            lead="At each stage the canary is compared with the baseline on error rate and latency. Play a healthy release, then a regression that is caught at 5% of traffic."
          />
          <RolloutDemo />
        </Section>

        <Section id="cli" label="Open-source CLI">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
            <CliFacts />
            <Terminal />
          </div>
        </Section>

        <Section id="how" label="How it works">
          <SectionHeader
            eyebrow="05 · How it works"
            title="From install to auto-rollback,"
            muted="in four steps."
            lead="Keep your CI, your registry and your cluster. Alror adds a check to pull requests and one step to your deploy job."
          />
          <HowItWorks />
        </Section>

        <Section id="console" label="Console">
          <SectionHeader
            eyebrow="Workspace"
            title="One console for every release."
            muted="Same engine, self-hosted."
            lead="Connect the CLI with an API key and every deployment shows up live. Queue deploys and rollbacks from the console; alror runner executes them inside your infrastructure."
          />
          <ConsoleShowcase />
        </Section>

        <Compare />
        <Trust />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
