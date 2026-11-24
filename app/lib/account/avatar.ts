// The generated profile picture: a small geometric pattern made from a seed (the account id, or a fixed word for a guest). The same seed always gives the same picture,
// it needs no network (it works offline) and it never uses a photo the user did not choose (the Google photo is never imported).

/** FNV-1a, 32 bits: a small stable hash. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A deterministic stream of small numbers from a seed. */
function stream(seed: string) {
  let h = hash32(seed) || 1;
  return (n: number) => {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h % n;
  };
}

/** The picture as SVG text (a 100 x 100 square; a round or square crop is the caller's CSS). */
export function defaultAvatarSvg(seed: string): string {
  const next = stream(seed || "hisaab");
  const hue = next(360);
  const bg = `hsl(${hue} 42% 34%)`;
  const light = `hsl(${(hue + 30) % 360} 55% 72%)`;
  const mid = `hsl(${(hue + 330) % 360} 48% 55%)`;
  const dark = `hsl(${hue} 40% 20%)`;
  const colours = [light, mid, dark];
  const shapes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const c = colours[next(3)]!;
    const x = 10 + next(60);
    const y = 10 + next(60);
    const s = 18 + next(34);
    const kind = next(3);
    if (kind === 0) shapes.push(`<circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2}" fill="${c}"/>`);
    else if (kind === 1) shapes.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${next(4) * 3}" fill="${c}"/>`);
    else shapes.push(`<polygon points="${x},${y + s} ${x + s / 2},${y} ${x + s},${y + s}" fill="${c}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect width="100" height="100" fill="${bg}"/>${shapes.join("")}</svg>`;
}

export const defaultAvatarUri = (seed: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(defaultAvatarSvg(seed))}`;
