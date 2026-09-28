import React from "react";
import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/components/public/og-card";
import { cachedEditionPage } from "@/app/(public)/_lib/data";
import { formatLongDate } from "@/lib/shared/public-event";

const SLUG = /^[a-z0-9](-?[a-z0-9]+)*$/;

/** Per-Edition social image when the Edition has no published photo (Master §59 "social image"). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug.length > 160 || !SLUG.test(slug)) return new Response("Not found", { status: 404 });
  const result = await cachedEditionPage(slug).catch(() => null);
  if (!result || result.redirect) return new Response("Not found", { status: 404 });
  const { edition, modalities } = result.edition;
  const distances = [...new Set(modalities.filter((m) => m.official_distance_m).map((m) => m.official_distance_m as number))]
    .sort((a, b) => a - b)
    .map((m) => (m >= 1000 ? `${Math.round(m / 100) / 10} km` : `${m} m`));
  const date = edition.schedule?.local_date ? formatLongDate(edition.schedule.local_date) : "Fecha por confirmar";

  return new ImageResponse(
    <OgCard title={edition.name} accent={date.charAt(0).toUpperCase() + date.slice(1)} lines={[`${edition.city}, ${edition.state_region}${distances.length ? ` · ${distances.join(" · ")}` : ""}`]} />,
    { ...OG_SIZE, headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } },
  );
}
