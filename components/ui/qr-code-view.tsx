"use client";

import React from "react";
import { RotateCw } from "lucide-react";
import { Modal, ModalContent } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * ui-spec §3.4 QRCodeView: Modal showing the server-rendered QR with `publicCode` always visible as
 * text beneath it, independent of the image (accessibility, print and low-connectivity fallback).
 * `loadQr` performs the private render (POST /api/v1/me/passes/:passId/render-qr, image/svg+xml,
 * no-store) and resolves to the SVG Blob; it runs on every open and every retry -- no cached image is
 * reused -- and the Blob is shown through a short-lived object URL in an <img>, never injected as
 * markup. Pass `state` only to force a state (previews/tests).
 */
export type QrCodeViewState = "loading" | "success" | "error";

export type QrCodeViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicCode: string;
  loadQr: (signal: AbortSignal) => Promise<Blob>;
  state?: QrCodeViewState;
  title?: string;
};

export function QrCodeView({ open, onOpenChange, publicCode, loadQr, state: forcedState, title = "Código QR" }: QrCodeViewProps) {
  const [attempt, setAttempt] = React.useState(0);
  const [result, setResult] = React.useState<{ attempt: number; url: string | null; failed: boolean } | null>(null);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    // Each open is a new attempt, so a previous render is never shown again.
    if (open) setAttempt((n) => n + 1);
  }
  const loadRef = React.useRef(loadQr);
  React.useEffect(() => {
    loadRef.current = loadQr;
  });

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let url: string | null = null;

    loadRef.current(controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResult({ attempt, url, failed: false });
      },
      () => {
        if (!controller.signal.aborted) setResult({ attempt, url: null, failed: true });
      },
    );

    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, attempt]);

  const current = result && result.attempt === attempt ? result : null;
  const state: QrCodeViewState = forcedState ?? (current ? (current.failed ? "error" : "success") : "loading");

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent title={title} description="Muéstralo en el acceso del evento. Puedes volver a verlo cuando quieras.">
        <figure className="flex flex-col items-center gap-4" aria-busy={state === "loading" || undefined}>
          <div className="flex size-64 max-w-full items-center justify-center">
            {state === "loading" ? <Skeleton className="size-full rounded-card" /> : null}
            {state === "error" ? (
              <Alert tone="danger" title="No pudimos generar tu código. Intenta de nuevo." className="w-full">
                <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)} className="mt-2">
                  <RotateCw className="size-4" aria-hidden="true" />
                  Reintentar
                </Button>
              </Alert>
            ) : null}
            {state === "success" && current?.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- private no-store render held in an object URL
              <img
                src={current.url}
                alt={`Código QR del pase ${publicCode}`}
                width={256}
                height={256}
                className="size-full rounded-card border border-divider bg-paper-raised p-3"
              />
            ) : null}
          </div>
          <figcaption className="text-center">
            <span className="block text-caption text-ink-60">Código público</span>
            <span className="block font-body text-h4 font-semibold tracking-[0.08em] text-ink tabular-nums">
              {publicCode}
            </span>
          </figcaption>
        </figure>
      </ModalContent>
    </Modal>
  );
}
