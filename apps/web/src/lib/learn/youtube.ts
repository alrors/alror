// YouTube link parsing, shared by the admin form (client) and the data layer (server).

const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Returns the 11-character video id from a YouTube link or a bare id, or null.
 * Accepts watch?v=, youtu.be/, /embed/, /shorts/ and /live/ links.
 */
export function youtubeId(input: string): string | null {
  const raw = input.trim();
  if (ID.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (first === "embed" || first === "shorts" || first === "live" || first === "v") id = second ?? null;
  }
  return id && ID.test(id) ? id : null;
}

export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;

