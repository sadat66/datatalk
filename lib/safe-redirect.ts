/**
 * Sanitize a user-supplied redirect path to prevent open-redirect attacks.
 * Rejects protocol-relative URLs (//evil.com), absolute URLs, and anything
 * that doesn't start with a single forward slash followed by a non-slash char
 * (or is just "/").
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (raw === "/") return fallback;
  if (!/^\/[^/\\]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, "http://n");
    if (url.hostname !== "n") return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
