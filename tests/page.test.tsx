import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "../app/page";

test("root page identifies technical RUNIIS bootstrap", () => {
  const html = renderToStaticMarkup(<Page />);

  assert.match(html, /RUNIIS WEB infrastructure ready/);
});
