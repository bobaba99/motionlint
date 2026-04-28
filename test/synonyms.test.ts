import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { categoriesAreCompatible, softKeywordMatch } from "../src/eval/synonyms.js";

describe("category synonym graph", () => {
  it("treats color and contrast as compatible", () => {
    assert.equal(categoriesAreCompatible("color", "contrast"), true);
    assert.equal(categoriesAreCompatible("contrast", "color"), true);
  });
  it("does not treat unrelated categories as compatible", () => {
    assert.equal(categoriesAreCompatible("typography", "loading_state"), false);
  });
  it("identity is always compatible", () => {
    assert.equal(categoriesAreCompatible("spacing", "spacing"), true);
  });
});

describe("soft keyword match", () => {
  it("matches on substring", () => {
    assert.equal(softKeywordMatch("The CTA button has poor contrast", ["cta", "button"]), true);
  });
  it("matches on canonicalized token overlap when exact substring is missing", () => {
    // Expected keyword "tap small target", model wrote "the touch button is undersized" — touch→tap, undersized→small via token synonyms.
    assert.equal(softKeywordMatch("the touch button is undersized", ["tap small target"]), true);
  });
  it("rejects when no overlap", () => {
    assert.equal(softKeywordMatch("the brand palette is cohesive", ["overflow", "scroll", "horizontal"]), false);
  });
  it("matches single-word keywords on 1-token overlap", () => {
    assert.equal(softKeywordMatch("body copy is too small", ["small"]), true);
  });
  it("ignores stopwords for token overlap", () => {
    assert.equal(softKeywordMatch("the and of with are", ["the and"]), false);
  });
});
