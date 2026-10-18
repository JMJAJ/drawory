// Turning links and files into board elements.

export type DetectedLink =
  | { kind: "youtube"; videoId: string; url: string }
  | { kind: "embed"; provider: "Spotify" | "Vimeo"; src: string; url: string; h: number }
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | { kind: "link"; url: string };

export function detectLink(input: string): DetectedLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^(www|m|music)\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (/^[\w-]{11}$/.test(id)) return { kind: "youtube", videoId: id, url: url.toString() };
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id =
      url.searchParams.get("v") ??
      url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)?.[1] ??
      null;
    if (id && /^[\w-]{11}$/.test(id)) return { kind: "youtube", videoId: id, url: url.toString() };
  }
  if (host === "open.spotify.com") {
    const m = url.pathname.match(/^\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/);
    if (m) {
      return {
        kind: "embed",
        provider: "Spotify",
        src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
        url: url.toString(),
        h: m[1] === "track" || m[1] === "episode" ? 152 : 380,
      };
    }
  }
  if (host === "vimeo.com") {
    const id = url.pathname.match(/^\/(\d+)/)?.[1];
    if (id) return { kind: "embed", provider: "Vimeo", src: `https://player.vimeo.com/video/${id}`, url: url.toString(), h: 0 };
  }
  if (/\.(png|jpe?g|gif|webp|avif)$/i.test(url.pathname)) return { kind: "image", url: url.toString() };
  if (/\.(mp4|webm|mov)$/i.test(url.pathname)) return { kind: "video", url: url.toString() };
  return { kind: "link", url: url.toString() };
}

export function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
    img.onerror = () => resolve({ w: 400, h: 300 });
    img.src = src;
  });
}

export function videoSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve({ w: v.videoWidth || 640, h: v.videoHeight || 360 });
    v.onerror = () => resolve({ w: 640, h: 360 });
    v.src = src;
  });
}

/** Loudness bars for a voice note, plus its length in seconds. */
export async function audioPeaks(blob: Blob, bars = 40): Promise<{ peaks: number[]; duration: number }> {
  try {
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) {
        max = Math.max(max, Math.abs(data[j]));
      }
      peaks.push(max);
    }
    const top = Math.max(...peaks, 0.01);
    ctx.close();
    return { peaks: peaks.map((p) => Math.round((p / top) * 100) / 100), duration: buffer.duration };
  } catch {
    return { peaks: Array.from({ length: bars }, () => 0.4), duration: 0 };
  }
}

export function fitWithin(w: number, h: number, max: number) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

const MAX_PHOTO_SIDE = 2560;

/**
 * Photos straight off a phone are often 4–12 MB. Re-encode big ones at a size that still looks
 * sharp on the board, so uploads are fast and the database doesn't fill up. GIFs keep their animation.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    // PNGs may be screenshots with transparency; keep that with WebP. Photos go to JPEG.
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.86));
    // Browsers without WebP encoding hand back a PNG instead; keep the original then.
    if (!blob || blob.type !== type || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, type === "image/jpeg" ? ".jpg" : ".webp"), { type });
  } catch {
    return file;
  }
}
