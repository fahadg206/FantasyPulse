// Twitter's own relative-timestamp convention: seconds as "now", then
// minutes/hours/days abbreviated to a single letter, then a plain date
// once it's more than a week old.
export function formatTwitterTimestamp(ms: number): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));

  if (diffSeconds < 60) return "now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

/** "9:41 PM · 8/22/26" - the full timestamp shown on a post's own expanded/detail view, not the relative one used in a feed row */
export function formatAbsoluteTimestamp(ms: number): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dateStr = date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
  return `${time} · ${dateStr}`;
}
