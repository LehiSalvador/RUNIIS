import React from "react";
import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/components/public/og-card";

export const dynamic = "force-static";

/** Default social image for public pages without their own (typographic, no invented artwork). */
export function GET() {
  return new ImageResponse(<OgCard title="Descubre carreras e inscríbete" lines={["Carreras creadas y operadas por el equipo RUNIIS."]} />, OG_SIZE);
}
