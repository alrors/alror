import type { Metadata } from "next";
import { AccessDenied } from "@/components/console/access-denied";
import { Card, EmptyState } from "@/components/console/primitives";
import { requireSession } from "@/lib/console/auth";
import { dateTime } from "@/lib/console/format";
import { ctxFor } from "@/lib/server/auth/accounts";
import { isAdminRole } from "@/lib/server/context";
import { listFeedback } from "@/lib/server/data/feedback";

export const metadata: Metadata = { title: "Feedback" };

export default async function FeedbackPage() {
  const session = await requireSession();
  if (!isAdminRole(session.role)) return <AccessDenied what="feedback" />;
  const items = await listFeedback(ctxFor(session), 100);
  return (
    <Card title="Feedback" description="Sent from the Feedback button in the top bar. Stored in this workspace's database only." flush>
      {items.length === 0 ? (
        <EmptyState title="No feedback yet" />
      ) : (
        <ul className="divide-y divide-con-row">
          {items.map((f) => (
            <li key={f.id} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px] text-con-fg3">
                <span>
                  {f.from ?? "former member"}
                  {f.page && <span className="font-mono"> · {f.page}</span>}
                </span>
                <span>{dateTime(f.created_at)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-[14px] text-con-fg">{f.message}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
