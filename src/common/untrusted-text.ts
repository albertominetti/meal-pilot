/**
 * Text from YouTube (titles, descriptions) or extracted from videos is
 * untrusted. Strip control characters and cap the length before it reaches a
 * prompt or a tool result.
 */
export function sanitizeUntrusted(value: string | undefined | null, maxLength: number): string {
  if (!value) return '';
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}
