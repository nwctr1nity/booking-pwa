import { studioPath } from '@/features/studio/paths';

// The access token goes in the URL fragment: it is never sent to a server
// in a request line and does not reach access logs or Referer headers.
export function bookingLink(slug: string, token: string) {
  return `${location.origin}${studioPath(slug, 'my')}#t=${encodeURIComponent(token)}`;
}

export function tokenFromHash(hash: string) {
  const m = /(?:^#|&)t=([^&]+)/.exec(hash);
  return m ? decodeURIComponent(m[1]!) : null;
}
