"use client";

import React from "react";

/**
 * Radix Dialog returns focus only to a Dialog.Trigger; dialogs opened from ordinary buttons (row
 * actions, controlled `open`) would drop focus on <body>. `useReturnFocus(open)` remembers the element
 * that was focused when the dialog opened (layout effect: before Radix moves focus inside) and gives
 * an `onCloseAutoFocus` handler that sends focus back to it.
 */
export function useReturnFocus(open: boolean) {
  const opener = React.useRef<HTMLElement | null>(null);
  const isOpen = React.useRef(open);
  React.useLayoutEffect(() => {
    isOpen.current = open;
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      opener.current = document.activeElement;
    }
  }, [open]);
  return React.useCallback((event: Event) => {
    event.preventDefault();
    // Reopened before the exit animation ended: moving focus outside would dismiss the new dialog.
    if (isOpen.current) return;
    if (opener.current?.isConnected) opener.current.focus();
  }, []);
}

/** For dialogs whose content props are not ours (e.g. QrCodeView): focus `element` once no dialog is mounted. */
export function focusWhenDialogsClosed(element: HTMLElement | null) {
  let frames = 0;
  const tick = () => {
    // A dialog still mounted after ~2 s was reopened: leave focus inside it.
    if (!document.querySelector('[role="dialog"]')) element?.focus();
    else if (frames++ < 120) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
