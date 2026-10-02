/** Public destinations shared by the landing page. */
export const REPO_URL = "https://github.com/alrors/alror";
export const DOCS_URL =
  process.env.NEXT_PUBLIC_ALROR_DOCS_URL ??
  `${REPO_URL}/tree/main/internal/docsite/content`;
export const QUICKSTART_URL = `${REPO_URL}/blob/main/internal/docsite/content/quickstart.md`;
