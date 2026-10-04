"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions, ModalContent } from "@/components/ui/modal";

/**
 * Unsaved-changes guard for edit forms. While `dirty`:
 *  - closing/reloading the tab asks the browser's own confirmation (beforeunload);
 *  - clicking any in-app link opens an accessible dialog instead of silently dropping the edits.
 * `window.history` back/forward is not interceptable in the App Router; the browser's beforeunload prompt covers
 * reload and tab close only. The form's own "Guardar" never navigates away, so a save never trips the guard.
 */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const [target, setTarget] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor || anchor.getAttribute("target") === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href.startsWith("//")) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget(href);
    };
    window.addEventListener("beforeunload", beforeUnload);
    // Capture phase: runs before Next's own link handler.
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  return (
    <Modal open={target !== null} onOpenChange={(open) => (open ? undefined : setTarget(null))}>
      <ModalContent title="Hay cambios sin guardar" description="Si sales ahora, los cambios de este formulario se perderán.">
        <ModalActions>
          <Button variant="secondary" onClick={() => setTarget(null)}>
            Seguir editando
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const href = target;
              setTarget(null);
              if (href) router.push(href);
            }}
          >
            Salir sin guardar
          </Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
