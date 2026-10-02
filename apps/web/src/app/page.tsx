import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { Section, SectionHeader } from "@/components/ui";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { Integrations } from "@/components/landing/integrations";
import { RiskDemo } from "@/components/landing/risk-demo";
import { RolloutDemo } from "@/components/landing/rollout-demo";
import { Terminal } from "@/components/landing/terminal";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ConsoleShowcase } from "@/components/landing/console-showcase";
import {
  FAQ,
  FinalCTA,
  Footer,
  OpenSource,
} from "@/components/landing/sections";
import { RevealObserver } from "@/components/landing/motion";
import { CliFacts } from "@/components/landing/cli-facts";
import "@/components/landing/landing.css";

const title = "Alror — The open-source release platform";
const description =
  "Ship at the speed of AI. Keep production safe. Open-source change-risk scoring, progressive rollouts, live verification, and automatic rollback. Self-host the CLI and console.";
export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", siteName: "Alror" },
  twitter: { card: "summary_large_image", title, description },
};

export default function Home() {
  return (
    <div className="lp flex min-h-full flex-1 flex-col">
      <RevealObserver />
      <Navbar />
      <main id="main" className="flex-1">
        <Hero />
        <Integrations />
        <Features />
        <Section id="risk" label="Risk scoring">
          <SectionHeader
            eyebrow="Change intelligence"
            title="Every change has a story."
            muted="Know it before you ship."
            lead="Turn a diff into a clear, auditable risk score. Critical paths, missing tests, recent rollbacks: see what matters and how it shapes your release. Try it below."
          />
          <RiskDemo />
        </Section>
        <Section id="verify" label="Verification and rollback">
          <SectionHeader
            eyebrow="Progressive delivery"
            title="Confidence at every step."
            muted="A way back, built in."
            lead="Compare your canary with the baseline on real error rates and latency. Watch a healthy release progress, or see a regression caught at just 5% of traffic."
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
            eyebrow="Fits your workflow"
            title="A safer pipeline."
            muted="Not a new pipeline."
            lead="Keep your CI, your registry, and your cluster. Add a check to your pull requests and one step to your deploy job. You're on your way."
          />
          <HowItWorks />
        </Section>
        <Section id="console" label="Workspace console">
          <SectionHeader
            eyebrow="The whole picture"
            title="One home for every release."
            muted="Hosted on your terms."
            lead="Live rollouts, shared policies, and the story behind every deployment. Connect the CLI to your self-hosted workspace and bring your team into the loop."
          />
          <ConsoleShowcase />
        </Section>
        <OpenSource />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
