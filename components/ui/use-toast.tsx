"use client";

import React from "react";
import { ToastItem, ToastProvider, ToastViewport, type ToastTone } from "@/components/ui/toast";

type ToastRecord = { id: string; tone: ToastTone; title: string; description?: string };

let listeners: Array<(toasts: ToastRecord[]) => void> = [];
let toasts: ToastRecord[] = [];
let nextId = 0;

function emit() {
  for (const listener of listeners) listener(toasts);
}

/** Queue a toast from any client code. Errors (`tone: "danger"`) stay until dismissed. */
export function toast(input: { tone: ToastTone; title: string; description?: string }): void {
  nextId += 1;
  const id = `toast-${nextId}`;
  toasts = [...toasts, { id, ...input }];
  emit();
}

function dismiss(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToastList(): ToastRecord[] {
  const [state, setState] = React.useState<ToastRecord[]>(toasts);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      listeners = listeners.filter((l) => l !== setState);
    };
  }, []);

  return state;
}

/** Mount once near the app root (root layout). Renders every toast queued via `toast(...)`. */
export function Toaster() {
  const list = useToastList();

  return (
    <ToastProvider swipeDirection="right">
      {list.map((item) => (
        <ToastItem
          key={item.id}
          tone={item.tone}
          title={item.title}
          description={item.description}
          onOpenChange={(open) => {
            if (!open) dismiss(item.id);
          }}
        />
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
