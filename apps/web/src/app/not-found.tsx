import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { buttonClass } from "@/components/console/primitives";
import { ErrorView, errorLink } from "@/components/errors/error-view";
import { RequestedPath } from "@/components/errors/not-found-views";
import { DOCS_URL as LOCAL_DOCS_URL } from "@/lib/console/config";

// Unmatched URLs anywhere on the site, notFound() outside the console, and the
// admin area for non-admins (the proxy rewrites it here, so it must stay generic).

const DOCS_URL = process.env.NEXT_PUBLIC_ALROR_DOCS_URL || LOCAL_DOCS_URL;

export default function NotFound() {
  return (
    <ErrorView
      variant="page"
      eyebrow="404"
      title="Page not found"
      actions={
        <>
          <Link href="/" className={buttonClass.primary}>
            Go to the home page
          </Link>
          <Link href="/app" className={buttonClass.secondary}>
            Open the console
          </Link>
        </>
      }
      links={
        <a href={DOCS_URL} target="_blank" rel="noreferrer" className={errorLink}>
          Read the docs
          <ArrowUpRight size={13} />
        </a>
      }
    >
      <title>Page not found · Alror</title>
      <p>This page doesn&apos;t exist or has moved. Check the address for typos, or pick up from one of the links below.</p>
      <RequestedPath />
    </ErrorView>
  );
}
