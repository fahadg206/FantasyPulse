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

/** "Sun 10:00 AM" - a game's kickoff, in the device's own local time (the ISO timestamp ESPN gives is UTC, `Date` converts it automatically). Used on the matchup detail page for a starter whose game hasn't kicked off yet, when there's no live state to show instead. */
export function formatGameKickoff(iso: string): string {
  const date = new Date(iso);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${weekday} ${time}`;
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
