import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

export type Asset = { body: Uint8Array<ArrayBuffer>; type: string };

/** Where the server takes the built UI from: a directory on disk, or the binary itself. */
export type UiAssets = {
  read(path: string): Promise<Asset | null>;
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export function contentType(path: string): string {
  return TYPES[extname(path)] ?? "application/octet-stream";
}

/** One file of the UI as `scripts/build.ts` writes it into the binary. */
export type EmbeddedAsset = { type: string; base64: string };

/** Serves the UI the binary carries inside itself: no files next to the executable. */
export function embeddedAssets(files: Record<string, EmbeddedAsset>): UiAssets {
  return {
    async read(path) {
      const file = files[path.replace(/^\//, "")];
      if (!file) return null;
      const binary = atob(file.base64);
      const body = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        body[index] = binary.charCodeAt(index);
      }
      return { body, type: file.type };
    },
  };
}

/** Serves `dist/ui` from disk: the npm channel and every development run. */
export function directoryAssets(dir: string): UiAssets {
  return {
    async read(path) {
      const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
      try {
        const raw = await readFile(join(dir, safe));
        const body = new Uint8Array(raw.byteLength);
        body.set(raw);
        return { body, type: contentType(safe) };
      } catch {
        return null;
      }
    },
  };
}
