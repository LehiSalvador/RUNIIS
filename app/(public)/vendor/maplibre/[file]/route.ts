import { readFile } from "node:fs/promises";
import { join } from "node:path";

// MapLibre 6 runs its tile/GeoJSON parsing in a module web worker that it loads by URL, relative to
// its own bundle file. Once bundled into a Next chunk that relative URL no longer exists, so the
// worker (and its shared module) are served verbatim from the installed package here, same-origin
// (CSP worker-src 'self'), and wired with maplibregl.setWorkerUrl in route-map-canvas.tsx.
// Only these two exact files are served; the version pin keeps the immutable cache honest.

const FILES = new Set(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]);

export const dynamic = "force-static";

export function generateStaticParams() {
  return [...FILES].map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = (await params).file;
  if (!FILES.has(file)) return new Response("Not found", { status: 404 });
  const body = await readFile(join(process.cwd(), "node_modules", "maplibre-gl", "dist", file), "utf8");
  return new Response(body, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
