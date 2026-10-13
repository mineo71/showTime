import path from 'node:path';

/** Only the studio's own address: a page on another host that resolves to 127.0.0.1 is refused. */
export function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** Browsers send Origin on cross-site requests; only our own may change anything. */
export function originAllowed(origin: string | undefined, port: number): boolean {
  return origin === undefined || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

/** The page's token, from the `x-showtime-token` header or (event streams can't set headers) `?token=`. */
export function tokenOk(headers: Record<string, string | string[] | undefined>, url: string, token: string): boolean {
  if (headers['x-showtime-token'] === token) return true;
  return new URL(url, 'http://studio').searchParams.get('token') === token;
}

/** A `/files/…` URL as a file inside `root`, or null when it points anywhere else. */
export function filePath(root: string, url: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(new URL(url, 'http://studio').pathname.replace(/^\/files\//, ''));
  } catch {
    return null;
  }
  if (!rel) return null;
  const file = path.resolve(root, rel);
  return file.startsWith(root + path.sep) ? file : null;
}
