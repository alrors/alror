import { notFound } from "next/navigation";
import { GlobalErrorPreview } from "@/components/errors/global-error-preview";
import { previewDigest } from "@/lib/error-kind";
import { ServiceUnavailableError } from "@/lib/server/errors";

// Development only: renders one site-level error screen by throwing what the real
// failure throws. Listed on /dev/errors.
export default async function SitePreview({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;
  if (screen === "not-found") notFound();
  if (screen === "route-error") throw new Error("Preview: a deliberately thrown error from /dev/errors/route-error.");
  if (screen === "database-unavailable") throw new ServiceUnavailableError("database_unavailable", undefined, previewDigest("database_unavailable"));
  if (screen === "cache-unavailable") throw new ServiceUnavailableError("cache_unavailable", undefined, previewDigest("cache_unavailable"));
  if (screen === "global-error") return <GlobalErrorPreview />;
  notFound();
}
