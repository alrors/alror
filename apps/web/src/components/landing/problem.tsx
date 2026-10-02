import Image from "next/image";
import { Section, SectionHeader } from "../ui";
import { CountUp } from "./motion";

export function Problem() {
  return (
    <Section id="why" label="Why Alror">
      <SectionHeader
        eyebrow="01 · The problem"
        title="AI made writing code cheap."
        muted="Releasing it is still risky."
        lead="Teams merge more changes than ever, many of them written by agents. Yet most pipelines still treat a green test run as proof that a change is safe to ship."
      />

      <div className="mt-14 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <figure className="lp-panel overflow-hidden rounded-2xl" data-reveal>
          <div className="relative aspect-[16/10] sm:aspect-[16/9]">
            <Image
              src="/generated/agents.webp"
              alt="Halftone photograph: rows of AI agents coding at desks, overseen by one engineer at a console"
              fill
              sizes="(min-width: 1200px) 680px, (min-width: 1024px) 58vw, 100vw"
              className="object-cover"
            />
          </div>
          <figcaption className="flex items-center justify-between gap-4 border-t border-[#1d1d22] px-4 py-3 text-[12.5px] text-[#a3a3ad]">
            <span>Agents write a growing share of production code. One engineer oversees it all.</span>
            <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6e6e78] sm:block">Fig. 01</span>
          </figcaption>
        </figure>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <Stat value={<CountUp value={90} suffix="%" />} label="of technology professionals now use AI at work." delay={0} />
          <Stat value={<CountUp value={30} suffix="%" />} label="have little or no trust in the code AI generates." delay={80} />
          <Stat
            value={<span aria-label="Down">↓</span>}
            label="Software delivery stability still falls as AI adoption rises."
            delay={160}
          />
        </div>
      </div>
      <p className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#6e6e78]">
        Source: Google Cloud, 2025 DORA State of AI-assisted Software Development report
      </p>
    </Section>
  );
}

function Stat({ value, label, delay }: { value: React.ReactNode; label: string; delay: number }) {
  return (
    <div
      className="lp-panel flex flex-col justify-between rounded-2xl p-6"
      data-reveal
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
    >
      <p className="text-[48px] font-semibold leading-none tracking-[-0.045em] text-fg tabular-nums">{value}</p>
      <p className="mt-6 text-[14px] leading-relaxed text-[#a3a3ad]">{label}</p>
    </div>
  );
}
