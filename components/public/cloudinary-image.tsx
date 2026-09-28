"use client";

import React from "react";
import Image, { type ImageLoaderProps } from "next/image";
import { publicMediaUrl } from "@/lib/shared/media-url";

type Aspect = "4:3" | "16:9";

/** next/image with Cloudinary as the only optimizer (ADR-001 A9): each srcset width is a Cloudinary
 * transform, never the built-in /_next/image proxy. Callers render it only when publicMediaUrl()
 * returned a URL for this key. */
export function CloudinaryImage({
  storageKey,
  alt,
  aspect,
  sizes,
  priority,
  focalPoint,
  className,
}: {
  storageKey: string;
  alt: string;
  aspect: Aspect;
  sizes: string;
  priority?: boolean;
  focalPoint?: { x: number; y: number } | null;
  className?: string;
}) {
  const loader = React.useCallback(
    ({ width }: ImageLoaderProps) => publicMediaUrl(storageKey, { width, aspect }) ?? "",
    [storageKey, aspect],
  );
  return (
    <Image
      loader={loader}
      src={storageKey}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={className}
      style={focalPoint ? { objectPosition: `${focalPoint.x * 100}% ${focalPoint.y * 100}%` } : undefined}
    />
  );
}
