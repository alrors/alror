"use client";

import { useState, useTransition } from "react";
import { ChevronUp } from "lucide-react";
import { votePlugin } from "@/app/app/marketplace/actions";
import { Spinner } from "@/components/console/loader";
import { buttonClass } from "@/components/console/primitives";
import { toast } from "@/components/console/shell-toast";
import { cn } from "@/lib/site";

/** "I want this" on a planned item: toggles the signed-in user's vote and shows the org's count. */
export function MarketplaceVote({ id, name, initial }: { id: string; name: string; initial: { count: number; mine: boolean } }) {
  const [vote, setVote] = useState(initial);
  const [pending, start] = useTransition();
  const click = () =>
    start(async () => {
      const r = await votePlugin(id);
      if (r.ok) {
        setVote(r.vote);
        toast.success(r.vote.mine ? `Vote recorded for ${name}.` : `Vote removed for ${name}.`);
      } else {
        toast.error(r.error);
      }
    });
  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      aria-pressed={vote.mine}
      className={cn(vote.mine ? buttonClass.secondary : buttonClass.primary, "pr-2")}
    >
      {pending ? <Spinner size={14} /> : <ChevronUp size={15} strokeWidth={2} aria-hidden />}
      {vote.mine ? "You want this" : "I want this"}
      <span
        className={cn(
          "ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[12px] tabular-nums",
          vote.mine ? "bg-con-row text-con-fg" : "bg-black/10 text-black",
        )}
        aria-label={`${vote.count} ${vote.count === 1 ? "vote" : "votes"}`}
      >
        {vote.count}
      </span>
    </button>
  );
}
