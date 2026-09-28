import React from "react";

// Social card for next/og (Satori): inline styles only. Typographic wordmark + Runline, ink canvas,
// signal lime used only as the underline/date accent (ui-spec §6: no invented artwork).

export const OG_SIZE = { width: 1200, height: 630 };

export function OgCard({ title, lines, accent }: { title: string; lines: string[]; accent?: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0B0D0E", color: "#F6F7F3", padding: "64px 72px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignSelf: "flex-start" }}>
        <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.01em" }}>RUNIIS</div>
        <div style={{ height: 4, background: "#D7FF3F", borderRadius: 999, marginTop: 6 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {accent ? <div style={{ fontSize: 40, fontWeight: 700, color: "#D7FF3F", marginBottom: 16 }}>{accent}</div> : null}
        <div style={{ fontSize: title.length > 40 ? 64 : 80, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em", maxWidth: 1000 }}>{title}</div>
        {lines.map((line) => (
          <div key={line} style={{ fontSize: 32, color: "rgba(246,247,243,0.75)", marginTop: 18 }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
