import Link from "next/link";
import { ArrowRight, Check, Rocket } from "lucide-react";

export type ChecklistStep = {
  title: string;
  body: string;
  done: boolean;
  href: string;
  cta: string;
};

export function OverviewChecklist({ steps }: { steps: ChecklistStep[] }) {
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <section className="dash-onboarding" aria-labelledby="setup-title">
      <div className="dash-onboarding-intro">
        <span className="dash-guide-icon">
          <Rocket size={19} />
        </span>
        <div>
          <span className="dash-eyebrow">Let&apos;s get you shipping</span>
          <h2 id="setup-title">Your first safe release starts here.</h2>
          <p>
            {done} of {steps.length} steps complete. Pick up right where you
            left off.
          </p>
        </div>
        {next && (
          <Link href={next.href} className="dash-primary">
            {next.title}
            <ArrowRight size={14} />
          </Link>
        )}
      </div>
      <div
        className="dash-setup-progress"
        role="progressbar"
        aria-label="Workspace setup"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={steps.length}
      >
        <span
          style={{
            width: `${steps.length ? (done / steps.length) * 100 : 0}%`,
          }}
        />
      </div>
      <details className="dash-setup-details">
        <summary>
          View setup checklist{" "}
          <span>
            {done}/{steps.length}
          </span>
        </summary>
        <ol>
          {steps.map((s, i) => (
            <li key={s.title} data-done={s.done}>
              <span className="dash-step-number">
                {s.done ? <Check size={13} /> : i + 1}
              </span>
              <div>
                <strong>
                  {s.title}
                  <span className="sr-only">
                    {s.done ? ", complete" : ", incomplete"}
                  </span>
                </strong>
                <p>{s.body}</p>
              </div>
              {!s.done && (
                <Link href={s.href}>
                  {s.cta}
                  <ArrowRight size={12} />
                </Link>
              )}
            </li>
          ))}
        </ol>
        <Link href="/app/onboarding" className="dash-text-link">
          Open the setup guide
          <ArrowRight size={13} />
        </Link>
      </details>
    </section>
  );
}
