import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import QRCode from "qrcode";

/** Renders a QR matrix as an RGBA frame: black modules on white, with the 4-module quiet zone, `scale` pixels per module. */
function frameOf(text: string, scale = 6) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const quiet = 4;
  const size = (qr.modules.size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < qr.modules.size; row++) {
    for (let col = 0; col < qr.modules.size; col++) {
      if (!qr.modules.get(row, col)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const at = (((row + quiet) * scale + y) * size + (col + quiet) * scale + x) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
        }
      }
    }
  }
  return { pixels, width: size, height: size };
}

// Counts how many times the jsqr module is evaluated: the decoder must only trigger it through its dynamic import, and only when needed.
const jsqrLoads = vi.hoisted(() => ({ count: 0 }));
/** A fresh copy of the decoder module (and of jsqr behind it) for every test, so the load counter is meaningful. */
async function freshDecoder() {
  vi.resetModules();
  jsqrLoads.count = 0;
  vi.doMock("jsqr", async (importOriginal) => {
    const original = await importOriginal<typeof import("jsqr")>();
    jsqrLoads.count += 1;
    return original;
  });
  return import("@/components/scanner/qr-decoder");
}
const loadJsQr = async () => (await vi.importActual<typeof import("jsqr")>("jsqr")).default;

const PASS_PAYLOAD = "RN1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ-_0123456789";

beforeEach(() => {
  jsqrLoads.count = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeFrame (jsqr)", () => {
  test("reads the exact text of a pass QR, byte for byte", async () => {
    const { decodeFrame } = await freshDecoder();
    const jsQR = await loadJsQr();
    const { pixels, width, height } = frameOf(PASS_PAYLOAD);
    expect(decodeFrame(jsQR, pixels, width, height)).toBe(PASS_PAYLOAD);
  });

  test("a frame with no code (or an empty one) is null, never an empty string", async () => {
    const { decodeFrame } = await freshDecoder();
    const jsQR = await loadJsQr();
    const blank = new Uint8ClampedArray(120 * 120 * 4).fill(255);
    expect(decodeFrame(jsQR, blank, 120, 120)).toBeNull();
    expect(decodeFrame(() => ({ data: "" }), blank, 120, 120)).toBeNull();
  });
});

describe("frameSize", () => {
  test("scales a large frame down to the longest side and keeps the aspect ratio", async () => {
    const { FALLBACK_MAX_SIDE, frameSize } = await freshDecoder();
    expect(frameSize(1920, 1080)).toEqual({ width: FALLBACK_MAX_SIDE, height: 360 });
    expect(frameSize(1080, 1920)).toEqual({ width: 360, height: FALLBACK_MAX_SIDE });
  });
  test("never scales up and refuses an empty or invalid frame", async () => {
    const { frameSize } = await freshDecoder();
    expect(frameSize(320, 240)).toEqual({ width: 320, height: 240 });
    expect(frameSize(0, 0)).toBeNull();
    expect(frameSize(Number.NaN, 100)).toBeNull();
  });
});

describe("createQrReader (feature detection)", () => {
  test("prefers the browser's BarcodeDetector and reports it as native", async () => {
    class Detector {
      detect = async () => [{ rawValue: "from-native" }];
    }
    vi.stubGlobal("window", { BarcodeDetector: Detector });
    const { createQrReader, nativeDetectorAvailable } = await freshDecoder();
    expect(nativeDetectorAvailable()).toBe(true);
    const reader = await createQrReader();
    expect(reader.kind).toBe("native");
    expect(await reader.read({} as HTMLVideoElement)).toBe("from-native");
    // the fallback decoder is never loaded on a browser that has BarcodeDetector
    expect(jsqrLoads.count).toBe(0);
  });

  test("without BarcodeDetector (iOS Safari) it loads jsqr and decodes frames drawn from the video", async () => {
    const { pixels, width, height } = frameOf(PASS_PAYLOAD);
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: pixels, width, height })),
    };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    const { createQrReader, nativeDetectorAvailable } = await freshDecoder();
    expect(nativeDetectorAvailable()).toBe(false);
    expect(jsqrLoads.count).toBe(0);
    const reader = await createQrReader();
    expect(reader.kind).toBe("fallback");
    expect(jsqrLoads.count).toBe(1);
    const video = { videoWidth: width, videoHeight: height } as HTMLVideoElement;
    expect(await reader.read(video)).toBe(PASS_PAYLOAD);
    // one canvas, sized to the frame, drawn from the video; nothing else leaves the function
    expect(canvas.width).toBe(width);
    expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, width, height);
    // a video that has no frame yet reads nothing
    expect(await reader.read({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement)).toBeNull();
  });
});
