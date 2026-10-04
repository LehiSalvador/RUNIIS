"use client";

import React from "react";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Camera reader for /scanner (the only route whose Permissions-Policy allows the camera). It uses the browser's own APIs only
 * (getUserMedia + BarcodeDetector): no third-party decoder, nothing leaves the device but the text of the code, which is passed to
 * `onCode` unchanged. The component never interprets, logs or stores what it reads; the server decides what the code means.
 *
 * Where the browser cannot read QR codes (BarcodeDetector is missing in iOS Safari and some desktop browsers) the component says so
 * and the page keeps working through the typed/pasted code field and the manual lookup.
 */
type DetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (options?: { formats?: string[] }) => DetectorLike;

export type CameraState = "idle" | "starting" | "live" | "denied" | "no_camera" | "insecure" | "unsupported" | "error";

const SAME_CODE_COOLDOWN_MS = 3_000;
const SCAN_INTERVAL_MS = 250;

export function cameraSupport(): CameraState | "ok" {
  if (typeof window === "undefined") return "ok";
  if (!window.isSecureContext && !navigator.mediaDevices) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  if (typeof (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector !== "function") return "unsupported";
  return "ok";
}

const STATE_MESSAGE: Partial<Record<CameraState, string>> = {
  denied: "El navegador no dio permiso a la cámara. Actívalo en los ajustes del sitio, o usa el código escrito o la búsqueda manual.",
  no_camera: "No encontramos una cámara en este dispositivo. Usa el código escrito o la búsqueda manual.",
  insecure: "La cámara solo funciona en una conexión segura (https). Usa el código escrito o la búsqueda manual.",
  unsupported: "Este navegador no puede leer códigos QR con la cámara. Usa el código escrito o la búsqueda manual.",
  error: "No pudimos abrir la cámara. Inténtalo de nuevo o usa el código escrito.",
};

export function QrCamera({ paused, onCode }: { paused: boolean; onCode: (rawValue: string) => void }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [state, setState] = React.useState<CameraState>("idle");
  const pausedRef = React.useRef(paused);
  const onCodeRef = React.useRef(onCode);
  React.useEffect(() => {
    pausedRef.current = paused;
    onCodeRef.current = onCode;
  });

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState("idle");
  }, []);

  React.useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    },
    [],
  );

  async function start() {
    const support = cameraSupport();
    if (support !== "ok") {
      setState(support);
      return;
    }
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setState("live");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "no_camera" : "error");
    }
  }

  // Detection loop: only while the stream is live. `paused` (a feedback screen is up) skips frames without touching the stream.
  React.useEffect(() => {
    if (state !== "live") return;
    const Detector = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    let detector: DetectorLike;
    try {
      detector = new Detector({ formats: ["qr_code"] });
    } catch {
      detector = new Detector();
    }
    let busy = false;
    let lastValue = "";
    let lastAt = 0;
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (busy || pausedRef.current || !video || video.readyState < 2) return;
      busy = true;
      try {
        const codes = await detector.detect(video);
        const value = codes[0]?.rawValue;
        if (value) {
          const now = Date.now();
          if (value !== lastValue || now - lastAt > SAME_CODE_COOLDOWN_MS) {
            lastValue = value;
            lastAt = now;
            onCodeRef.current(value);
          }
        }
      } catch {
        // A frame that cannot be read is skipped; the next tick tries again.
      } finally {
        busy = false;
      }
    }, SCAN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [state]);

  const live = state === "live";
  const message = STATE_MESSAGE[state];

  return (
    <section aria-label="Cámara" className="flex flex-col gap-3">
      <div className="relative aspect-square w-full max-h-[46dvh] overflow-hidden rounded-card border border-paper/25 bg-ink-80">
        {/* The element always exists so the stream can attach; it is only meaningful (and announced) while live. */}
        <video ref={videoRef} playsInline muted aria-hidden={!live} className={live ? "size-full object-cover" : "hidden"} data-testid="scanner-video" />
        {live ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-card border-4 border-lime" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-paper">
            <CameraOff className="size-10" aria-hidden="true" />
            <p className="text-body-sm" role={message ? "status" : undefined}>
              {state === "starting" ? "Abriendo la cámara…" : (message ?? "La cámara está apagada.")}
            </p>
          </div>
        )}
      </div>
      {live ? (
        <Button variant="secondary" size="lg" onClick={stop} className="w-full">
          <CameraOff className="size-5" aria-hidden="true" />
          Apagar cámara
        </Button>
      ) : (
        <Button size="lg" onClick={start} loading={state === "starting"} className="w-full border-lime bg-lime text-ink hover:border-lime hover:bg-lime/90">
          <Camera className="size-5" aria-hidden="true" />
          {state === "idle" || state === "starting" ? "Activar cámara" : "Intentar de nuevo"}
        </Button>
      )}
    </section>
  );
}
