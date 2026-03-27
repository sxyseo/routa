// Copyright (c) OpenAI. All rights reserved.
"use strict";

// This file is reconstructed from the partial `text subset` snippet stored in
// `tools/ppt-template/gpt/temp.fiel`. The upstream helper was not fully present
// in the captured artifact, so only the safe, self-contained pieces are
// materialized here and the advanced text-fit helper is left as a stub.

function calcTextBoxHeightSimple(
  fontSize,
  lines = 1,
  leading = 1.15,
  padding = 0.3
) {
  const lineHeightIn = (fontSize / 72) * leading;
  return lines * lineHeightIn + padding;
}

function autoFontSize() {
  throw new Error(
    "Partial helper extract: autoFontSize requires the full upstream text.js implementation."
  );
}

module.exports = {
  calcTextBoxHeightSimple,
  autoFontSize,
};
