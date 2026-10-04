import React from "react";

/**
 * Focus handling for dialogs and sheets that are opened from state (a row button sets `open`) rather than through a Radix trigger: Radix
 * can only return focus to a trigger it knows, so without this the focus falls to the page body when the dialog closes and a keyboard user
 * loses their place in the table. Spread the result on the content: it remembers the element that had focus when the dialog opened (the
 * mount hook runs BEFORE Radix moves focus inside) and puts focus back there on close, unless that element is gone (a refresh replaced the
 * row), in which case Radix's default applies.
 */
export function useReturnFocus() {
  const opener = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const target = opener.current;
      opener.current = null;
      if (target?.isConnected) {
        event.preventDefault();
        target.focus();
      }
    },
  };
}
