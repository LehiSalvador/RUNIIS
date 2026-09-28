import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must know the custom @theme scales in app/globals.css; otherwise a size token such
// as `text-body` is read as a color and silently drops `text-paper` (invisible button labels).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display-xl", "h1", "h2", "h3", "h4", "body-lg", "body", "body-sm", "label", "caption", "button"],
      radius: ["control", "card", "panel", "overlay", "hero"],
      font: ["display", "body"],
      ease: ["standard", "exit"],
    },
    classGroups: {
      z: [
        {
          z: [
            "base",
            "sticky-header",
            "sticky-cta",
            "dropdown",
            "drawer",
            "modal-backdrop",
            "modal",
            "popover",
            "toast",
            "tooltip",
            "scanner-feedback",
            "skip-link",
          ],
        },
      ],
      duration: [{ duration: ["micro", "fast", "control", "panel", "major"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
