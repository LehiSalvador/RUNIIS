import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import Page from "@/app/(public)/page";

test("interim home renders the hero headline and primary CTA", () => {
  const html = renderToStaticMarkup(<Page />);

  expect(html).toContain("Descubre carreras, inscríbete y consulta tu ranking verificado.");
  expect(html).toContain('href="/eventos"');
});
