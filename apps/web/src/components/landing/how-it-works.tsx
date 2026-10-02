"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/site";

type Step = { title: string; body: string; file: string; code: string };

const STEPS: Step[] = [
  {
    title: "Install the CLI and initialise",
    body: "One binary. `alror init` writes alror.yaml and a .alror/ folder. Try it with no infrastructure: the default target and metrics are simulated.",
    file: "Terminal",
    code: `$ curl -fsSL https://raw.githubusercontent.com/alrors/alror/main/scripts/install.sh | sh
$ cd path/to/your/repo
$ alror init      # alror.yaml + .alror/
$ alror risk      # score your current change
$ alror deploy -s checkout-api -i registry/checkout:1.43 --regress error_rate=1.8   # watch a rollback`,
  },
  {
    title: "Score every pull request",
    body: "The check action posts an Alror / change-risk check run and one sticky comment with the score, the factors and the rollout plan. Set fail-above to turn it into a merge gate.",
    file: ".github/workflows/alror.yml",
    code: `jobs:
  risk:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: write          # the "Alror / change-risk" check run
      pull-requests: write   # the sticky risk comment
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: alrors/alror/actions/check@main
        with:
          comment: "true"
          fail-above: "85"   # block very risky PRs`,
  },
  {
    title: "Deploy through the gate",
    body: "Keep your build. Replace the deploy command with one step. The score picks the plan, and a rolled-back release fails the job, so the bad release is visible.",
    file: ".github/workflows/alror.yml",
    code: `  deploy:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      # … build and push your image here …
      - uses: alrors/alror/actions/deploy@main
        id: alror
        with:
          service: checkout-api
          image: registry.example.com/checkout-api:\${{ github.sha }}
          shadow: "false"    # "true" recommends rollbacks, never acts`,
  },
  {
    title: "Verify against your metrics",
    body: "Point Alror at Prometheus or Datadog. Each stage compares canary and baseline; a regression past the limit with p below α rolls traffic back on its own.",
    file: "alror.yaml",
    code: `services:
  - name: checkout-api
    paths: [services/checkout/]
    target: kubernetes      # Argo Rollouts, or ecs (beta)
    critical: true
metrics:
  provider: prometheus      # or datadog
  url: http://prometheus:9090
policy:
  max_regression:
    error_rate: 0.25        # +25%
    latency_p95: 0.15       # +15%
  alpha: 0.05
  auto_rollback: true
notify:
  slack_webhook: https://hooks.slack.com/services/…`,
  },
];

/** Minimal highlighting: comments dim, YAML keys bright, prompts green. */
function Code({ code }: { code: string }) {
  return (
    <pre className="lp-scroll overflow-x-auto p-4 font-mono text-[12px] leading-[20px] sm:p-5 sm:text-[12.5px]">
      <code>
        {code.split("\n").map((line, i) => {
          const hash = line.search(/\s#\s|^#|\s# /);
          const body = hash >= 0 ? line.slice(0, hash) : line;
          const comment = hash >= 0 ? line.slice(hash) : "";
          const prompt = body.startsWith("$ ");
          const m = !prompt ? body.match(/^(\s*-?\s*)([\w.-]+)(:)(.*)$/) : null;
          return (
            <div key={i} className="min-h-[20px] whitespace-pre">
              {prompt ? (
                <>
                  <span className="text-[#35e08f]">$ </span>
                  <span className="text-[#e4e4e7]">{body.slice(2)}</span>
                </>
              ) : m ? (
                <>
                  <span className="text-[#6e6e78]">{m[1]}</span>
                  <span className="text-[#e4e4e7]">{m[2]}</span>
                  <span className="text-[#6e6e78]">{m[3]}</span>
                  <span className="text-[#a3a3ad]">{m[4]}</span>
                </>
              ) : (
                <span className="text-[#a3a3ad]">{body}</span>
              )}
              {comment && <span className="text-[#55555e]">{comment}</span>}
            </div>
          );
        })}
      </code>
    </pre>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} className="rounded bg-[#17171b] px-1 py-px font-mono text-[0.9em] text-[#d4d4d8]">
            {p.slice(1, -1)}
          </code>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = [...list.querySelectorAll<HTMLElement>("[data-step]")];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    items.forEach((el) => io.observe(el));

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = list.getBoundingClientRect();
        const mid = window.innerHeight * 0.5;
        const p = (mid - r.top) / Math.max(1, r.height);
        setProgress(Math.max(0, Math.min(1, p)));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="mt-14 grid gap-10 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-16">
      {/* Sticky index with a scroll-linked rail (desktop) */}
      <nav aria-label="Setup steps" className="hidden lg:block">
        <div className="sticky top-28">
          <div className="relative pl-6">
            <span className="absolute top-1 bottom-1 left-[5px] w-px bg-[#1f1f24]" aria-hidden />
            <span
              className="absolute top-1 left-[5px] w-px origin-top bg-[#d4d4d8]"
              style={{ height: "calc(100% - 8px)", transform: `scaleY(${progress})` }}
              aria-hidden
            />
            <ol className="space-y-6">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative">
                  <span
                    className={cn(
                      "absolute top-[5px] -left-[23px] h-[9px] w-[9px] rounded-full border transition-colors duration-300",
                      i <= active ? "border-[#d4d4d8] bg-[#d4d4d8]" : "border-[#3a3a42] bg-[#08080a]",
                    )}
                    aria-hidden
                  />
                  <a
                    href={`#step-${i + 1}`}
                    aria-current={i === active ? "step" : undefined}
                    className={cn(
                      "block text-[14px] leading-snug transition-colors duration-300 hover:text-fg",
                      i === active ? "text-fg" : "text-[#6e6e78]",
                    )}
                  >
                    <span className="mr-2 font-mono text-[11px] text-[#55555e]">{String(i + 1).padStart(2, "0")}</span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
            <p className="mt-10 text-[13px] leading-relaxed text-[#6e6e78]">
              Most teams start in shadow mode: Alror records what it would have done, then you let it act.
            </p>
          </div>
        </div>
      </nav>

      <ol ref={listRef} className="space-y-6 lg:space-y-10">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            id={`step-${i + 1}`}
            data-step={i}
            className={cn(
              "scroll-mt-28 transition-opacity duration-500 lg:opacity-50",
              i === active && "lg:opacity-100",
            )}
          >
            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] xl:gap-8">
              <div>
                <p className="font-mono text-[11px] text-[#55555e]">Step {String(i + 1).padStart(2, "0")}</p>
                <h3 className="mt-2 text-[22px] font-semibold tracking-[-0.025em] text-fg">{s.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[#a3a3ad]">
                  <Inline text={s.body} />
                </p>
              </div>
              <div className="lp-panel min-w-0 overflow-hidden rounded-xl bg-[#09090b]">
                <div className="flex h-9 items-center border-b border-[#1d1d22] px-4 font-mono text-[11px] text-[#6e6e78]">
                  {s.file}
                </div>
                <Code code={s.code} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
