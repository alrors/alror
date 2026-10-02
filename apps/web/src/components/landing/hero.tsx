import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { Button, Container } from "../ui";
import { GithubLogo } from "./brand-logos";
import { REPO_URL } from "./links";
import { ReleasePreview } from "./release-preview";

export function Hero() {
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-hero-grid" aria-hidden />
      <Container>
        <div className="lp-hero-copy">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="lp-announcement"
          >
            <span className="lp-status-dot" />
            Open source. Open possibilities.
            <span className="lp-announcement-arrow">
              <ArrowRight size={13} aria-hidden />
            </span>
          </a>
          <h1 id="hero-title">
            Ship at the speed of AI.
            <br />
            <span>Keep production safe.</span>
          </h1>
          <p className="lp-hero-lead">
            The open-source release platform that scores every change, verifies
            every rollout, and rolls back when a regression hits.
          </p>
          <div className="lp-hero-actions">
            <Button href="#cli" size="lg" className="lp-button-accent">
              Start building <ArrowRight size={16} aria-hidden />
            </Button>
            <Button href={REPO_URL} size="lg" variant="secondary" external>
              <GithubLogo /> Star on GitHub{" "}
              <ArrowUpRight size={14} aria-hidden />
            </Button>
          </div>
          <div className="lp-hero-proof">
            <span>
              <Check size={12} aria-hidden /> Apache-2.0 licensed
            </span>
            <span>
              <Check size={12} aria-hidden /> Self-hosted by design
            </span>
            <span>
              <Check size={12} aria-hidden /> Your existing CI
            </span>
          </div>
        </div>
        <ReleasePreview />
        <div className="lp-preview-caption">
          <span />
          From pull request to production. Every decision, explained.
          <span />
        </div>
      </Container>
    </section>
  );
}
