import { ArrowUpRight, Fingerprint, GitBranch, RotateCcw } from "lucide-react";
import { Container, Eyebrow } from "../ui";

const features = [
  {
    icon: Fingerprint,
    number: "01",
    title: "Understand the change.",
    body: "A risk score with a reason behind every point. Know what changed and what deserves a closer look.",
    href: "#risk",
    link: "Explore risk scoring",
    visual: "risk",
  },
  {
    icon: GitBranch,
    number: "02",
    title: "Release at the right pace.",
    body: "Small changes move fast. Risky changes take smaller steps, with live metrics checking every stage.",
    href: "#verify",
    link: "See progressive delivery",
    visual: "stages",
  },
  {
    icon: RotateCcw,
    number: "03",
    title: "Recover automatically.",
    body: "When the canary regresses, traffic returns to the baseline. You get the evidence behind the decision.",
    href: "#verify",
    link: "Watch a rollback",
    visual: "rollback",
  },
];

export function Features() {
  return (
    <section
      id="platform"
      className="lp-features lp-rule"
      aria-labelledby="platform-title"
    >
      <Container>
        <div className="lp-section-intro" data-reveal>
          <div>
            <Eyebrow>The missing step in your pipeline</Eyebrow>
            <h2 id="platform-title">
              More velocity.
              <br />
              <span>Less crossed fingers.</span>
            </h2>
          </div>
          <p>
            Your tests check the code. Alror checks the release.
            <br />
            One continuous safety net, from merge to production.
          </p>
        </div>
        <div className="lp-feature-grid">
          {features.map((f) => (
            <a
              key={f.number}
              href={f.href}
              className="lp-feature-card"
              data-reveal
            >
              <div className="lp-feature-top">
                <f.icon size={19} strokeWidth={1.5} />
                <span>{f.number}</span>
              </div>
              <div
                className={`lp-feature-art lp-feature-art-${f.visual}`}
                aria-hidden
              >
                {f.visual === "risk" ? (
                  <>
                    <div className="lp-mini-score">
                      62<span>/ 100</span>
                    </div>
                    <div className="lp-mini-bars">
                      {Array.from({ length: 24 }, (_, i) => (
                        <i key={i} style={{ opacity: i < 15 ? 1 : 0.16 }} />
                      ))}
                    </div>
                    <small>Every factor. Fully explainable.</small>
                  </>
                ) : f.visual === "stages" ? (
                  <>
                    <div className="lp-mini-stages">
                      {["5%", "25%", "50%", "100%"].map((s, i) => (
                        <span key={s} className={i < 2 ? "is-active" : ""}>
                          {s}
                        </span>
                      ))}
                    </div>
                    <small>Confidence grows. Traffic follows.</small>
                  </>
                ) : (
                  <>
                    <div className="lp-mini-rollback">
                      <span>
                        <i />
                        canary
                      </span>
                      <RotateCcw size={20} />
                      <span>
                        <i />
                        baseline
                      </span>
                    </div>
                    <small>A regression. Already handled.</small>
                  </>
                )}
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              <span className="lp-feature-link">
                {f.link}
                <ArrowUpRight size={14} />
              </span>
            </a>
          ))}
        </div>
      </Container>
    </section>
  );
}
