// Format a timestamp as a short relative-date string for cards.
//   < 60s        → "just now"
//   < 60m        → "5 minutes ago"  (single unit, ceil for "5m" not "4m 59s")
//   < 24h        → "3 hours ago"
//   < 7d         → "2 days ago"
//   < 14d        → "yesterday" / "1 week ago"
//   ≥ 14d        → "Apr 27" or "Apr 27 2025" depending on year
//
// Compact — designed to fit a card meta row, not a tooltip. For
// precise timestamps the modal renders the full Date.toLocaleString().

export function relativeDate(input) {
  if (!input) return '';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    // Future date — used for expires_at on announcements where we
    // want "in 3 days" framing rather than "3 days ago." Lightweight
    // implementation: same magnitudes, "in" prefix, no past tense.
    return formatFuture(-diffMs);
  }
  return formatPast(diffMs, date);
}

function formatPast(ms, date) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  if (day < 14) return '1 week ago';
  if (day < 30) return `${Math.floor(day / 7)} weeks ago`;
  // ≥ 30 days: fall back to a month-day label, with year if not current.
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function formatFuture(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'in moments';
  const min = Math.floor(sec / 60);
  if (min < 60) return `in ${min} minute${min === 1 ? '' : 's'}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `in ${hr} hour${hr === 1 ? '' : 's'}`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'tomorrow';
  if (day < 7) return `in ${day} days`;
  return `in ${Math.floor(day / 7)} week${day < 14 ? '' : 's'}`;
}
