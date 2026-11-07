import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const frontendFiles = [
  "app.js",
  "features.js",
  "portal-extras.js",
  "physical-card-shop.js",
  "shop-plan.js",
  "shop-management.js",
  "tutorial.js",
  "index.html",
];

const forbidden = [
  { label: "Werbefloskeln", pattern: /\b(?:erlebe|entdecke|revolutioniere|magisch|nahtlos|mühelos|bahnbrechend)\b/i },
  { label: "Metatext zu erfundenen Personendaten", pattern: /ohne erfundene personendaten/i },
  { label: "Unbelegte Druckbehauptung", pattern: /(?:glatten druckschichten|völlig bündig)/i },
  { label: "Dekorative Marketing-Emojis", pattern: /[✨🚀🎉🔥🪄]/u },
];

test("Die redaktionellen UI-Standards werden eingehalten", () => {
  for (const file of frontendFiles) {
    const source = readFileSync(file, "utf8");
    for (const rule of forbidden) {
      assert.doesNotMatch(source, rule.pattern, file + ": " + rule.label);
    }
  }
});

test("Anmeldeseite hat eine klare Überschriftenhierarchie", () => {
  const app = readFileSync("app.js", "utf8");
  assert.match(app, /class="welcome-hero">Das Schulportal\.<\/div>/);
  assert.doesNotMatch(app, /class="welcome-hero">Schule als Staat\.<\/div>/);
});

test("Die Druckkarte nennt Maße als Sollwerte", () => {
  const shop = readFileSync("physical-card-shop.js", "utf8");
  assert.match(shop, /Sollmaß: 0,6 mm/);
  assert.doesNotMatch(shop, /exakt 3 × 0,2 mm/);
});
