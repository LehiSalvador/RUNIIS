import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import Page from "@/app/page";

test("root page identifies technical RUNIIS bootstrap", () => {
  const html = renderToStaticMarkup(<Page />);

  expect(html).toMatch(/RUNIIS WEB infrastructure ready/);
});
