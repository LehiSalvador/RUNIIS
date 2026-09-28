import React from "react";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { publicMediaUrl } from "@/lib/shared/media-url";
import { dateTileParts } from "@/lib/shared/public-event";
import { CloudinaryImage } from "@/components/public/cloudinary-image";

type CoverImage = { storage_object_key: string; alt_text: string; focal_point?: Record<string, unknown> | null } | null;

function focal(point: Record<string, unknown> | null | undefined): { x: number; y: number } | null {
  const x = point?.x;
  const y = point?.y;
  return typeof x === "number" && typeof y === "number" && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

/**
 * Event imagery (ui-spec §5.1): a real published photo through Cloudinary, or -- until one exists --
 * a typographic results-board tile built only from the Edition's own data (date, distance). Never a
 * stock or generated scene standing in for a real race.
 */
export function EventCover({
  image,
  sportDate,
  distanceLabel,
  variant,
  priority,
  overlay,
  className,
}: {
  image: CoverImage;
  sportDate: string | null;
  distanceLabel: string;
  variant: "card" | "hero";
  priority?: boolean;
  overlay?: React.ReactNode;
  className?: string;
}) {
  const photo = image && publicMediaUrl(image.storage_object_key, { width: 800 }) ? image : null;
  const parts = sportDate ? dateTileParts(sportDate) : null;
  const hero = variant === "hero";

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden bg-paper-sunken",
        hero ? "aspect-4/3 rounded-panel lg:aspect-video" : "aspect-4/3",
        className,
      )}
    >
      {photo ? (
        <CloudinaryImage
          storageKey={photo.storage_object_key}
          alt={photo.alt_text}
          aspect={hero ? "16:9" : "4:3"}
          sizes={hero ? "(min-width: 1024px) 66vw, 100vw" : "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"}
          priority={priority}
          focalPoint={focal(photo.focal_point)}
          className="object-cover"
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-end p-4 sm:p-5">
          {/* Track-lane rules: the 1px divider token, not a Runline (ui-spec §5.3 forbids Runline texture). */}
          <div className="absolute inset-x-0 top-1/3 border-t border-divider" />
          <div className="relative flex items-end justify-between gap-4">
            {parts ? (
              <div className="flex items-end gap-2 text-ink">
                <span className={cn("font-display font-bold leading-[0.8] tabular-nums", hero ? "text-[120px] sm:text-[160px]" : "text-[112px]")}>
                  {parts.day}
                </span>
                <span className={cn("flex flex-col pb-1.5 font-display font-bold leading-none", hero ? "text-h2" : "text-h3")}>
                  <span>{parts.month}</span>
                  <span className="text-ink-60">{parts.year}</span>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-ink-60">
                <CalendarClock className="size-10" />
                <span className="font-display text-h4 font-bold">Fecha por confirmar</span>
              </div>
            )}
            <span className={cn("pb-1 text-right font-display font-bold leading-none text-ink tabular-nums", hero ? "text-h3" : "text-h4")}>
              {distanceLabel}
            </span>
          </div>
        </div>
      )}
      {overlay ? <div className="absolute left-3 top-3 z-10 sm:left-4 sm:top-4">{overlay}</div> : null}
    </div>
  );
}
