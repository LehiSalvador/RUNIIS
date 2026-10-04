"use client";

import React from "react";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createQrReader, type QrReader } from "@/components/scanner/qr-decoder";

/**
 * Camera reader for /scanner (the only route whose Permissions-Policy allows the camera). The stream comes from getUserMedia and is
 * decoded on the device: by the browser's BarcodeDetector when it exists, otherwise by jsqr (pure JavaScript, loaded on demand), which
 * is what makes the camera work on iOS Safari. Nothing leaves the device but the text of the code, passed to `onCode` unchanged. The
 * component never interprets, logs or stores what it reads; the server decides what the code means.
 *
 * Where the browser has no camera API at all, or the fallback reader cannot be loaded, the component says so and the page keeps
 * working through the typed/pasted code field and the manual lookup.
 */
export type CameraState = "idle" | "starting" | "live" | "denied" | "no_camera" | "insecure" | "unsupported" | "decoder_failed" | "error";

const SAME_CODE_COOLDOWN_MS = 3_000;
const SCAN_INTERVAL_MS = 250;

export function cameraSupport(): CameraState | "ok" {
  if (typeof window === "undefined") return "ok";
  if (!window.isSecureContext && !navigator.mediaDevices) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  return "ok";
}

const STATE_MESSAGE: Partial<Record<CameraState, string>> = {
  denied: "El navegador no dio permiso a la cámara. Actívalo en los ajustes del sitio, o usa el código escrito o la búsqueda manual.",
  no_camera: "No encontramos una cámara en este dispositivo. Usa el código escrito o la búsqueda manual.",
  insecure: "La cámara solo funciona en una conexión segura (https). Usa el código escrito o la búsqueda manual.",
  unsupported: "Este navegador no puede abrir la cámara. Usa el código escrito o la búsqueda manual.",
  decoder_failed: "No pudimos cargar el lector de códigos. Revisa la conexión e inténtalo de nuevo, o usa el código escrito.",
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
  // The reader is chosen here (native first, jsqr loaded on demand otherwise); if it cannot be loaded the camera is turned off and
  // the operator is told, instead of showing a live preview that never reads anything.
  React.useEffect(() => {
    if (state !== "live") return;
    let alive = true;
    let timer: number | undefined;
    createQrReader().then(
      (reader: QrReader) => {
        if (!alive) return;
        let busy = false;
        let lastValue = "";
        let lastAt = 0;
        timer = window.setInterval(async () => {
          const video = videoRef.current;
          if (busy || pausedRef.current || !video || video.readyState < 2) return;
          busy = true;
          try {
            const value = await reader.read(video);
            if (value && alive) {
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
      },
      () => {
        if (!alive) return;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setState("decoder_failed");
      },
    );
    return () => {
      alive = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
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
