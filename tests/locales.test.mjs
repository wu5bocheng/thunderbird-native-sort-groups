/* SPDX-License-Identifier: MPL-2.0 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
const root = new URL("../", import.meta.url);
const catalog = (locale) =>
  JSON.parse(
    readFileSync(new URL(`_locales/${locale}/messages.json`, root), "utf8"),
  );
const locales = readdirSync(new URL("_locales/", root));
test("every locale has exactly the English keys, non-empty strings and valid metadata", () => {
  const expected = Object.keys(catalog("en")).sort();
  assert.equal(locales.length, 7);
  for (const locale of locales) {
    const messages = catalog(locale);
    assert.deepEqual(Object.keys(messages).sort(), expected, locale);
    for (const [key, { message }] of Object.entries(messages))
      assert.ok(
        typeof message === "string" && message.trim(),
        `${locale}.${key}`,
      );
    assert.ok(messages.addonName.message.length <= 50, locale);
    assert.ok(messages.addonDescription.message.length <= 250, locale);
  }
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", root), "utf8"),
  );
  assert.equal(manifest.default_locale, "en");
  for (const value of [
    manifest.name,
    manifest.description,
    manifest.browser_action.default_title,
  ])
    assert.ok(catalog("en")[value.slice(6, -2)]);
});
test("localized group labels never change persistent keys, message membership or ordering", () => {
  const scope = {};
  runInNewContext(
    readFileSync(new URL("native/tree-model.js", root), "utf8"),
    scope,
  );
  const now = new Date(2026, 9, 24, 12),
    messages = [
      { uri: "one", author: "a@example.com", date: +now, read: false },
      {
        uri: "two",
        author: "b@example.com",
        date: +now - 86400000,
        read: true,
      },
    ];
  for (const locale of locales) {
    const labels = Object.fromEntries(
      Object.entries(catalog(locale)).map(([k, v]) => [k, v.message]),
    );
    const model = new scope.NativeGroupModel(
      messages,
      () => "example.com",
      new Set(),
      now,
      new Set(),
      { labels, locale: locale.replace("_", "-") },
    );
    assert.equal(model.roots[0].label, labels.today);
    assert.equal(model.roots[1].label, labels.yesterday);
    assert.equal(model.roots.map((r) => r.key).join(","), "today,yesterday");
    assert.equal(
      model
        .resolveSelection([0, 1])
        .map((m) => m.uri)
        .join(","),
      "one,two",
    );
  }
});
