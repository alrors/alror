import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button, Container } from "../ui";
import { HeroGate } from "./hero-gate";
import { InstallCommand, REPO_URL } from "./install";
import { GithubLogo } from "./brand-logos";

export function Hero() {
  return (
    <section className="relative overflow-x-clip pt-12 pb-20 sm:pt-16 lg:pt-16 lg:pb-24" aria-labelledby="hero-title">
      <Container className="grid grid-cols-[minmax(0,1fr)] items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12 xl:gap-16">
        <div className="relative z-10 min-w-0">
          <a
            href={`${REPO_URL}/releases`}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 rounded-full border border-[#24242a] bg-[#0e0e11] py-1 pr-3 pl-1 text-[12.5px] text-[#a3a3ad] transition-colors hover:border-[#34343c] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"
          >
            <span className="rounded-full bg-[#1c1c21] px-2 py-0.5 font-mono text-[11px] text-fg">v0.1.0</span>
            Open-source CLI, Apache-2.0
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </a>

          <h1
            id="hero-title"
            className="mt-7 text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] text-balance text-fg sm:text-[56px] lg:text-[52px] xl:text-[58px]"
          >
            Ship every change at the speed of AI, <span className="text-[#6e6e78]">safely.</span>
          </h1>

          <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-[#a3a3ad]">
            Alror scores every pull request for risk, sizes the canary to match, verifies each step against live
            metrics and rolls back on its own when a release hurts users. Keep your CI.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button href="/app" size="lg">
              Open the console
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
            <Button href={REPO_URL} size="lg" variant="secondary" external>
              <GithubLogo />
              View on GitHub
              <ArrowUpRight className="h-3.5 w-3.5 text-[#6e6e78]" aria-hidden />
            </Button>
          </div>

          <InstallCommand className="mt-6 max-w-[34rem]" />

          <p className="mt-5 font-mono text-[11px] tracking-[0.04em] text-[#6e6e78]">
            Kubernetes · Amazon ECS (beta) · Prometheus · Datadog · GitHub Actions · Slack
          </p>
        </div>

        <div className="relative min-w-0 lg:-mr-4">
          <HeroGate />
        </div>
      </Container>
    </section>
  );
}
