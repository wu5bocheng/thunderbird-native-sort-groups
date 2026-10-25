/* SPDX-License-Identifier: MPL-2.0 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const scope = {};
runInNewContext(
  readFileSync(new URL("../native/tree-model.js", import.meta.url), "utf8"),
  scope,
);
const Model = scope.NativeGroupModel;
const date = new Date(2026, 9, 24, 12);
const base = { date: +date, read: false };
const source = (a) =>
  a.endsWith("@gmail.com") ? a : a.split("@")[1].split(".").slice(-2).join(".");
test("date and source groups start collapsed; each level opens independently", () => {
  const model = new Model(
    [
      { ...base, uri: "a", author: "news@news.example.com" },
      { ...base, uri: "b", author: "deal@offers.example.com" },
      { ...base, uri: "c", author: "alice@gmail.com" },
      { ...base, uri: "d", author: "bob@gmail.com" },
    ],
    source,
    new Set(),
    date,
  );
  assert.equal(model.rows.length, 1);
  assert.equal(model.roots[0].children.length, 3);
  assert.equal(model.roots[0].count, 4);
  model.toggle(0);
  assert.equal(model.rows.length, 4);
  assert.equal(model.roots[0].children[0].count, 2);
  model.toggle(1);
  assert.equal(model.rows.map((r) => r.level).join(","), "0,1,2,2,1,1");
  model.toggle(1);
  assert.equal(model.rows.length, 4);
  assert.equal(model.reveal("b"), 3);
  model.toggle(0);
  assert.equal(model.rows.length, 1);
});
test("source groups follow newest received message, never alphabetic domain order", () => {
  const collapsed = new Set(),
    seen = new Set();
  const messages = [
    { ...base, date: +date - 3000, uri: "a", author: "a@aaa.com" },
    { ...base, date: +date - 1000, uri: "z", author: "a@zzz.com" },
    { ...base, date: +date - 2000, uri: "m", author: "a@mmm.com" },
  ];
  const model = new Model(messages, source, collapsed, date, seen);
  model.toggle(0);
  model.toggle(1);
  assert.equal(
    model.roots[0].children.map((g) => g.label).join(","),
    "zzz.com,mmm.com,aaa.com",
  );
  const refreshed = new Model(
    [
      ...messages,
      { ...base, date: +date, uri: "new", author: "news@aaa.com" },
      { ...base, date: +date - 500, uri: "brand", author: "a@new.com" },
    ],
    source,
    collapsed,
    date,
    seen,
  );
  assert.equal(
    refreshed.roots[0].children.map((g) => g.label).join(","),
    "aaa.com,new.com,zzz.com,mmm.com",
  );
  assert.ok(!refreshed.collapsed.has("today"));
  assert.ok(!refreshed.collapsed.has("today/zzz.com"));
  assert.ok(refreshed.collapsed.has("today/new.com")); // New sources do not expand themselves.
});
test("relative date buckets and unread counts survive collapsed views", () => {
  const model = new Model(
    [
      { ...base, uri: "a", author: "a@example.com" },
      {
        ...base,
        date: +date - 86400000,
        read: true,
        uri: "b",
        author: "b@example.com",
      },
      {
        ...base,
        date: +date - 3 * 86400000,
        uri: "c",
        author: "c@example.com",
      },
    ],
    source,
    new Set(),
    date,
  );
  assert.equal(
    model.roots.map((r) => r.label).join(","),
    "Today,Yesterday,Last 7 days",
  );
  assert.equal(model.roots[1].unread, 0);
  assert.equal(model.rows.length, 3);
});
test("group, parent and leaf selections expand to a deduplicated real message set", () => {
  const messages = [
    { ...base, uri: "mailbox-a#1", author: "a@example.com" },
    {
      ...base,
      date: +date - 1000,
      uri: "mailbox-b#1",
      author: "b@example.com",
    },
    {
      ...base,
      date: +date - 2000,
      uri: "mailbox-a#2",
      author: "alice@gmail.com",
    },
  ];
  const model = new Model(messages, source, new Set(), date);
  assert.equal(model.resolveSelection([0]).length, 3); // Collapsed date includes all descendants.
  model.toggle(0);
  model.toggle(1);
  assert.equal(
    model
      .resolveSelection([0, 1, 2, 3])
      .map((m) => m.uri)
      .join(","),
    "mailbox-a#1,mailbox-b#1,mailbox-a#2",
  );
  assert.equal(model.resolveSelection([1]).length, 2); // Equal numeric keys in different folders remain distinct.
  assert.equal(model.resolveSelection([-1, 100]).length, 0);
  const filtered = new Model(messages.slice(0, 1), source, new Set(), date);
  assert.equal(filtered.resolveSelection([0]).length, 1); // Hidden/filter-excluded messages are not selected.
});
test("ungrouped combination sorts messages without inserting headers, in selected field order", () => {
  const messages = [
    { ...base, date: +date - 1000, uri: "z-new", author: "a@zzz.com" },
    { ...base, date: +date - 3000, uri: "z-old", author: "a@zzz.com" },
    { ...base, date: +date - 2000, uri: "a", author: "a@aaa.com" },
  ];
  const domainFirst = new Model(messages, source, new Set(), date, new Set(), {
    keys: ["nativeDomainCol", "dateCol"],
    grouped: false,
  });
  assert.equal(domainFirst.rows.map((r) => r.uri).join(","), "z-new,z-old,a");
  assert.ok(domainFirst.rows.every((r) => !r.children && r.level === 0));
  const dateFirst = new Model(messages, source, new Set(), date, new Set(), {
    keys: ["dateCol", "nativeDomainCol"],
    grouped: false,
  });
  assert.equal(dateFirst.rows.map((r) => r.uri).join(","), "z-new,a,z-old");
  const ascending = new Model(messages, source, new Set(), date, new Set(), {
    keys: ["nativeDomainCol", "dateCol"],
    grouped: false,
    order: "ascending",
  });
  assert.equal(ascending.rows.map((r) => r.uri).join(","), "a,z-old,z-new");
});
test("arbitrary four-level group hierarchy preserves parent links and counts", () => {
  const m = {
    ...base,
    uri: "one",
    author: "a@example.com",
    sortFields: {
      unreadButtonColHeader: { key: 0, value: 0, label: "未读" },
      flaggedCol: { key: 1, value: 1, label: "有星标" },
    },
  };
  const model = new Model([m], source, new Set(), date, new Set(), {
    keys: ["flaggedCol", "nativeDomainCol", "dateCol", "unreadButtonColHeader"],
    grouped: true,
  });
  assert.equal(model.roots[0].label, "有星标");
  for (const group of model.groups()) model.collapsed.delete(group.key);
  model.flatten();
  assert.equal(model.rows.map((r) => r.level).join(","), "0,1,2,3,4");
  assert.equal(model.messagesFor(model.roots[0]).length, 1);
  assert.equal(model.rows[4].parent, model.rows[3]);
});
