/**
 * QR decoding for the camera reader. Two interchangeable readers sit behind one shape:
 *
 *   native    the browser's own BarcodeDetector (Chrome, Android, Edge). Always preferred when it exists: it is faster and costs nothing.
 *   fallback  jsqr (pure JavaScript, no WebAssembly, no worker, no network), for browsers without BarcodeDetector, notably iOS Safari.
 *
 * jsqr is imported dynamically, only when the native detector is missing, so a phone that has BarcodeDetector never downloads it. The
 * chunk is served from this origin, so the Content-Security-Policy is unchanged. Frames are decoded on the device from the camera
 * stream; what leaves it is the decoded text, handed to the caller untouched (never parsed, logged or stored here).
 */
export type QrReader = {
  kind: "native" | "fallback";
  /** The text of the first QR code in the current video frame, or null when the frame holds none. */
  read: (video: HTMLVideoElement) => Promise<string | null>;
};

type DetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (options?: { formats?: string[] }) => DetectorLike;

/** The longest side, in pixels, of the frame handed to jsqr: bigger frames cost time and do not decode better. */
export const FALLBACK_MAX_SIDE = 640;

export function nativeDetectorAvailable(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector === "function";
}

/** Size of the canvas a video frame is drawn on: the frame scaled down (never up) so its longest side is `maxSide`. */
export function frameSize(videoWidth: number, videoHeight: number, maxSide: number = FALLBACK_MAX_SIDE): { width: number; height: number } | null {
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight) || videoWidth < 1 || videoHeight < 1) return null;
  const scale = Math.min(1, maxSide / Math.max(videoWidth, videoHeight));
  return { width: Math.max(1, Math.round(videoWidth * scale)), height: Math.max(1, Math.round(videoHeight * scale)) };
}

export type JsQrFunction = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) => { data: string } | null;

/** Decodes one RGBA frame. An empty string is not a code. */
export function decodeFrame(jsQR: JsQrFunction, pixels: Uint8ClampedArray, width: number, height: number): string | null {
  const found = jsQR(pixels, width, height, { inversionAttempts: "dontInvert" });
  return found && found.data.length > 0 ? found.data : null;
}

function nativeReader(): QrReader {
  const Detector = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
  let detector: DetectorLike;
  try {
    detector = new Detector({ formats: ["qr_code"] });
  } catch {
    detector = new Detector();
  }
  return {
    kind: "native",
    read: async (video) => {
      const codes = await detector.detect(video);
      return codes[0]?.rawValue || null;
    },
  };
}

async function fallbackReader(): Promise<QrReader> {
  const { default: jsQR } = await import("jsqr");
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  return {
    kind: "fallback",
    read: async (video) => {
      const size = frameSize(video.videoWidth, video.videoHeight);
      if (!size) return null;
      if (!canvas) {
        canvas = document.createElement("canvas");
        context = canvas.getContext("2d", { willReadFrequently: true });
      }
      if (!context) return null;
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      context.drawImage(video, 0, 0, size.width, size.height);
      const frame = context.getImageData(0, 0, size.width, size.height);
      return decodeFrame(jsQR, frame.data, size.width, size.height);
    },
  };
}

/** Feature-detects first: BarcodeDetector when the browser has it, otherwise jsqr (loaded now, on demand). Rejects if jsqr cannot be loaded. */
export async function createQrReader(): Promise<QrReader> {
  return nativeDetectorAvailable() ? nativeReader() : fallbackReader();
}
