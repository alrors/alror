import { ConsoleNotFound } from "@/components/errors/not-found-views";
import { getSession } from "@/lib/console/auth";

// notFound() in console pages (unknown deployment, service or plugin ids) and
// unknown /app/* paths (see [...missing]). Renders inside the console shell.
export default async function ConsoleNotFoundPage() {
  const session = await getSession().catch(() => null);
  return (
    <>
      <title>Not found · Alror console</title>
      <ConsoleNotFound org={session?.org.slug ?? null} />
    </>
  );
}
