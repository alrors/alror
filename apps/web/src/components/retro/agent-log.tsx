"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "@/components/landing/motion";

// The hero's "agent session": a check and a canary that regresses and rolls
// back on its own. Lines appear one by one, then the session restarts.

type Line = { kind: "cmd" | "out" | "ok" | "bad" | "dim"; text: string };

const SESSION: Line[] = [
  { kind: "cmd", text: "alror check --pr 482" },
  { kind: "out", text: "◆ reading diff ........ 14 files · 2 services" },
  { kind: "out", text: "◆ risk score .......... 62/100 · payments path, 3 tests removed" },
  { kind: "out", text: "◆ policy .............. canary 5% → 25% → 50% → 100%" },
  { kind: "cmd", text: "alror deploy checkout-api:v2.41.0" },
  { kind: "ok", text: "▸  5%  errors 0.21% vs 0.20%   p99 182ms vs 180ms   ✓ pass" },
  { kind: "ok", text: "▸ 25%  errors 0.20% vs 0.20%   p99 181ms vs 180ms   ✓ pass" },
  { kind: "bad", text: "▸ 50%  errors 1.94% vs 0.20%   p99 412ms vs 181ms   ✗ regression" },
  { kind: "bad", text: "↺ rolled back in 41s · traffic → baseline · exit 2" },
  { kind: "dim", text: "evidence attached to PR #482 · on-call not paged" },
];

export function AgentLog() {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(1);

  useEffect(() => {
    if (reduced) return;
    const done = shown >= SESSION.length;
    const next = SESSION[shown];
    const delay = done ? 4200 : next?.kind === "cmd" ? 1100 : 520;
    const id = setTimeout(() => setShown(done ? 1 : shown + 1), delay);
    return () => clearTimeout(id);
  }, [shown, reduced]);

  const lines = reduced ? SESSION : SESSION.slice(0, shown);
  const running = !reduced && shown < SESSION.length;

  return (
    <div className="rx-agent" role="log" aria-label="Example Alror session" aria-live="off">
      {lines.map((l, i) => (
        <p key={i} className={`rx-agent-${l.kind}`}>
          {l.kind === "cmd" && <span className="rx-agent-prompt">agent@ci:~$ </span>}
          {l.text}
        </p>
      ))}
      <p className="rx-agent-cursor-line">
        <span className="rx-agent-prompt">agent@ci:~$ </span>
        <span className="rx-agent-cursor" aria-hidden />
        {running && <span className="sr-only">running</span>}
      </p>
    </div>
  );
}
