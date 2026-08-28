import type { BookImage } from './types.ts';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

export function mimeFromPath(path: string, fallback = 'application/octet-stream'): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'bmp':
      return 'image/bmp';
    default:
      return fallback;
  }
}

export function uniqueImageHref(used: Set<string>, sourcePath: string): string {
  const raw = sourcePath.split('/').pop() || 'image.bin';
  const safe = raw.replace(/[^\w.-]+/g, '_') || 'image.bin';
  if (!used.has(safe)) {
    used.add(safe);
    return `images/${safe}`;
  }
  const dot = safe.lastIndexOf('.');
  const stem = dot === -1 ? safe : safe.slice(0, dot);
  const ext = dot === -1 ? '' : safe.slice(dot);
  let n = 2;
  while (used.has(`${stem}-${n}${ext}`)) n += 1;
  const name = `${stem}-${n}${ext}`;
  used.add(name);
  return `images/${name}`;
}

/** Collects images and maps original container paths onto stable markdown hrefs. */
export class ImageBag {
  readonly images: BookImage[] = [];
  private readonly bySource = new Map<string, string>();
  private readonly used = new Set<string>();

  add(sourcePath: string, bytes: Uint8Array, mimeType: string): string {
    const existing = this.bySource.get(sourcePath);
    if (existing) return existing;
    const href = uniqueImageHref(this.used, sourcePath);
    this.bySource.set(sourcePath, href);
    const base = sourcePath.split('/').pop();
    if (base && !this.bySource.has(base)) this.bySource.set(base, href);
    this.images.push({ href, bytes, mimeType });
    return href;
  }

  hrefFor(sourcePath: string): string | undefined {
    const trimmed = sourcePath.replace(/^#/, '').trim();
    if (!trimmed) return undefined;
    return (
      this.bySource.get(trimmed) ??
      this.bySource.get(trimmed.replace(/^\//, '')) ??
      this.bySource.get(trimmed.split('/').pop() ?? '')
    );
  }
}
