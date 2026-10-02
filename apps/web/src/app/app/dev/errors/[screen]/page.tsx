import { notFound } from "next/navigation";
import { AccessDeniedView } from "@/components/console/access-denied";
import { ActionToastPreview } from "@/components/errors/action-toast-preview";
import { requireSession } from "@/lib/console/auth";
import { previewDigest } from "@/lib/error-kind";
import { ctxFor } from "@/lib/server/auth/accounts";
import { listMembers } from "@/lib/server/auth/members";
import { ServiceUnavailableError } from "@/lib/server/errors";

// Development only: console error screens inside the shell. Listed on /dev/errors.
export default async function ConsolePreview({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;
  if (screen === "route-error") throw new Error("Preview: a deliberately thrown error from /app/dev/errors/route-error.");
  if (screen === "database-unavailable") throw new ServiceUnavailableError("database_unavailable", undefined, previewDigest("database_unavailable"));
  if (screen === "cache-unavailable") throw new ServiceUnavailableError("cache_unavailable", undefined, previewDigest("cache_unavailable"));
  if (screen === "action-toast") return <ActionToastPreview />;
  if (screen === "access-denied") {
    // As a member would see the API keys page; the people listed are this org's real owners and admins.
    const session = await requireSession();
    const admins = (await listMembers(ctxFor(session))).filter((m) => m.role === "owner" || m.role === "admin").slice(0, 4);
    return (
      <div className="mx-auto max-w-3xl">
        <AccessDeniedView what="API keys" role="member" org={session.org.name} admins={admins} />
      </div>
    );
  }
  notFound();
}
