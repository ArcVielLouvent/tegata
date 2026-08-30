/**
 * TS port of apps/agent/src/tegata_agent/ttl.py — only
 * seconds_until_expiry(), the piece needed for Stretch F's (ROADMAP.md
 * Phase 7 #6, "extension request") countdown UI. compute_expires_at()
 * and is_expired() stay server-side (Xano's scheduled task is the real
 * enforcement — see ttl.py's own module docs); this file is display
 * logic only, never used to decide whether access is actually still
 * valid.
 */
export function secondsUntilExpiry(expiresAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return null;
  return (expiry.getTime() - now.getTime()) / 1000;
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "expired";
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m remaining`;
  }
  return `${minutes}m ${secs}s remaining`;
}
