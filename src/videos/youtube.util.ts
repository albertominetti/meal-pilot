/** Extract a YouTube video id from a raw id or URL. Returns null if unparseable. */
export function extractVideoId(idOrUrl: string): string | null {
  const raw = (idOrUrl ?? '').trim();
  if (!raw) return null;
  // Plain 11-char id (allow slightly longer for safety).
  if (/^[A-Za-z0-9_-]{6,20}$/.test(raw) && !raw.includes('.') && !raw.includes('/')) {
    return raw;
  }
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{6,20}$/.test(v)) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      // /embed/<id>, /shorts/<id>, /live/<id>
      if (['embed', 'shorts', 'live'].includes(parts[0]) && parts[1]) {
        return /^[A-Za-z0-9_-]{6,20}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
