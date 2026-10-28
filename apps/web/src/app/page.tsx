import type { Metadata } from "next";
import { Pixelify_Sans } from "next/font/google";
import { ConsoleShowcase } from "@/components/landing/console-showcase";
import { HowItWorks } from "@/components/landing/how-it-works";
import { RevealObserver } from "@/components/landing/motion";
import { RiskDemo } from "@/components/landing/risk-demo";
import { RolloutDemo } from "@/components/landing/rollout-demo";
import { Terminal } from "@/components/landing/terminal";
import {
  DemoSection,
  RetroCli,
  RetroCta,
  RetroFaq,
  RetroFeatures,
  RetroFooter,
  RetroHero,
  RetroNav,
  RetroOpenSource,
  RetroStack,
  RetroTicker,
} from "@/components/retro/sections";
// landing.css styles the interactive demos, which render inside dark .lp screens.
import "@/components/landing/landing.css";
import "@/components/retro/retro.css";

const pixel = Pixelify_Sans({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-pixel", display: "swap" });

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
    <div className={`rx ${pixel.variable} flex min-h-full flex-1 flex-col`}>
      <RevealObserver />
      <RetroNav />
      <main id="main" className="flex-1">
        <RetroHero />
        <RetroTicker />
        <RetroStack />
        <RetroFeatures />
        <DemoSection
          id="risk"
          label="Risk scoring"
          eyebrow="change intelligence"
          title="Every change has a story."
          marker="Know it before you ship."
          lead="Turn a diff into a clear, auditable risk score. Critical paths, missing tests, recent rollbacks: see what matters and how it shapes your release. Try it below."
          window="risk_scanner.exe"
          tone="butter"
        >
          <RiskDemo />
        </DemoSection>
        <DemoSection
          id="verify"
          label="Verification and rollback"
          eyebrow="progressive delivery"
          title="Confidence at every step."
          marker="A way back, built in."
          lead="Compare your canary with the baseline on real error rates and latency. Watch a healthy release progress, or see a regression caught at just 5% of traffic."
          window="canary_watch.exe"
          tone="lime"
        >
          <RolloutDemo />
        </DemoSection>
        <RetroCli terminal={<Terminal />} />
        <DemoSection
          id="how"
          label="How it works"
          eyebrow="fits your workflow"
          title="A safer pipeline."
          marker="Not a new pipeline."
          lead="Keep your CI, your registry and your cluster. Add a check to your pull requests and one step to your deploy job. You're on your way."
          window="pipeline.exe"
          tone="sky"
        >
          <HowItWorks />
        </DemoSection>
        <DemoSection
          id="console"
          label="Workspace console"
          eyebrow="the whole picture"
          title="One home for every release."
          marker="Hosted on your terms."
          lead="Live rollouts, shared policies and the story behind every deployment. Connect the CLI to your self-hosted workspace and bring your team into the loop."
          window="console.exe"
          tone="lilac"
        >
          <ConsoleShowcase />
        </DemoSection>
        <RetroOpenSource />
        <RetroFaq />
        <RetroCta />
      </main>
      <RetroFooter />
    </div>
  );
}
