import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { cn } from "@/lib/client/cn";

// SEC-061/062: editor markdown renders without raw HTML (skipHtml), through a link scheme allowlist,
// with no images (media only comes from published assets) and with every external link marked
// rel="noopener noreferrer nofollow ugc".

const ALLOWED_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

export function safeMarkdownUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return ALLOWED_SCHEMES.includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

const components: Components = {
  // Headings inside editor content sit under the page's own h2/h3 sections.
  h1: ({ children }) => <h3 className="text-h4 font-body font-bold text-ink">{children}</h3>,
  h2: ({ children }) => <h3 className="text-h4 font-body font-bold text-ink">{children}</h3>,
  h3: ({ children }) => <h4 className="text-body-lg font-semibold text-ink">{children}</h4>,
  h4: ({ children }) => <h4 className="text-body-lg font-semibold text-ink">{children}</h4>,
  h5: ({ children }) => <p className="font-semibold text-ink">{children}</p>,
  h6: ({ children }) => <p className="font-semibold text-ink">{children}</p>,
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>;
    const external = isExternal(href);
    return (
      <a
        href={href}
        className="font-semibold text-lime-deep underline underline-offset-4 hover:text-ink"
        {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow ugc" } : {})}
      >
        {children}
      </a>
    );
  },
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-divider pl-4 text-ink-80">{children}</blockquote>,
  code: ({ children }) => <code className="rounded-xs bg-paper-sunken px-1 py-0.5 text-body-sm">{children}</code>,
  hr: () => <hr className="border-divider" />,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("space-y-3 text-body text-ink-80", className)}>
      <ReactMarkdown
        skipHtml
        disallowedElements={["img"]}
        unwrapDisallowed={false}
        urlTransform={(url) => safeMarkdownUrl(url) ?? ""}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
