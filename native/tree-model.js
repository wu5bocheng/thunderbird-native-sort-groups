/* SPDX-License-Identifier: MPL-2.0 */
/* Presentation-only model. Native headers and commands remain the source of mail state. */
var NativeSortFields = [
  {
    id: "dateCol",
    sortKey: "byDate",
  },
  {
    id: "receivedCol",
    sortKey: "byReceived",
  },
  {
    id: "flaggedCol",
    sortKey: "byFlagged",
  },
  {
    id: "idCol",
    sortKey: "byId",
  },
  {
    id: "priorityCol",
    sortKey: "byPriority",
  },
  {
    id: "senderCol",
    sortKey: "byAuthor",
  },
  {
    id: "nativeDomainCol",
    sortKey: "byNativeDomain",
  },
  {
    id: "recipientCol",
    sortKey: "byRecipient",
  },
  {
    id: "correspondentCol",
    sortKey: "byCorrespondent",
  },
  {
    id: "sizeCol",
    sortKey: "bySize",
  },
  {
    id: "statusCol",
    sortKey: "byStatus",
  },
  {
    id: "subjectCol",
    sortKey: "bySubject",
  },
  {
    id: "unreadButtonColHeader",
    sortKey: "byUnread",
  },
  {
    id: "tagsCol",
    sortKey: "byTags",
  },
  {
    id: "junkStatusCol",
    sortKey: "byJunkStatus",
  },
  {
    id: "attachmentCol",
    sortKey: "byAttachments",
  },
];
var NativeGroupModel = class {
  constructor(
    messages,
    source,
    collapsed = new Set(),
    now = new Date(),
    seen = new Set(),
    options = {},
  ) {
    this.collapsed = collapsed;
    this.options = {
      keys: ["dateCol", "nativeDomainCol"],
      grouped: true,
      order: "descending",
      ...options,
    };
    const labels = {
      future: "Future",
      today: "Today",
      yesterday: "Yesterday",
      week: "Last 7 days",
      fortnight: "Last 14 days",
      older: "Older",
      none: "(None)",
      ...options.labels,
    };
    const keys = this.options.keys,
      sign = this.options.order === "ascending" ? 1 : -1;
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const bucket = (date) => {
      const d = new Date(date),
        ago = Math.round(
          (midnight -
            new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
            86400000,
        );
      if (ago < 0) return ["future", labels.future];
      if (ago === 0) return ["today", labels.today];
      if (ago === 1) return ["yesterday", labels.yesterday];
      if (ago < 7) return ["week", labels.week];
      if (ago < 14) return ["fortnight", labels.fortnight];
      return ["older", labels.older];
    };
    const compare = (a, b) =>
      typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b), this.options.locale, {
            numeric: true,
            sensitivity: "base",
          });
    const field = (m, id, grouped) => {
      if (id === "dateCol" || id === "receivedCol") {
        const date = id === "receivedCol" ? m.received || m.date : m.date;
        if (grouped) {
          const [key, label] = bucket(date);
          return {
            key: id === "dateCol" ? key : "received:" + key,
            label,
            value: date,
            latestOrder: true,
          };
        }
        return { key: String(date), value: date, label: String(date) };
      }
      if (id === "nativeDomainCol")
        return {
          key: source(m.author),
          label: source(m.author),
          latestOrder: true,
        };
      const f = m.sortFields?.[id] || {
        key: "",
        value: "",
        label: labels.none,
      };
      return {
        ...f,
        key: id + ":" + encodeURIComponent(String(f.key)),
        label: f.label || labels.none,
      };
    };
    const leaves = messages.map((m) => ({ ...m, key: "msg:" + m.uri }));
    const partition = (items, depth, parent) => {
      if (depth === keys.length)
        return [...items]
          .sort(
            (a, b) => sign * (a.date - b.date) || a.uri.localeCompare(b.uri),
          )
          .map((m) => ({ ...m, level: depth, parent }));
      const id = keys[depth],
        partitions = new Map();
      for (const message of items) {
        const f = field(message, id, this.options.grouped);
        if (!partitions.has(f.key))
          partitions.set(f.key, { field: f, items: [], latest: -Infinity });
        const p = partitions.get(f.key);
        p.items.push(message);
        p.latest = Math.max(
          p.latest,
          f.latestOrder && id !== "nativeDomainCol"
            ? Number(f.value)
            : message.date,
        );
      }
      const sorted = [...partitions.values()].sort(
        (a, b) =>
          sign *
          (a.field.latestOrder
            ? a.latest - b.latest
            : compare(a.field.value, b.field.value)),
      );
      if (!this.options.grouped)
        return sorted.flatMap((p) => partition(p.items, depth + 1, null));
      return sorted.map((p) => {
        const key = parent ? parent.key + "/" + p.field.key : p.field.key;
        const node = {
          key,
          label: p.field.label,
          field: id,
          level: depth,
          parent,
          latest: p.latest,
          count: p.items.length,
          unread: p.items.filter((m) => !m.read).length,
        };
        node.children = partition(p.items, depth + 1, node);
        if (!seen.has(key)) {
          collapsed.add(key);
          seen.add(key);
        }
        return node;
      });
    };
    this.roots = partition(leaves, 0, null);
    if (!this.options.grouped)
      for (const row of this.roots) {
        row.level = 0;
        delete row.parent;
      }
    this.flatten();
  }
  flatten() {
    this.rows = [];
    const visit = (node) => {
      this.rows.push(node);
      if (node.children && !this.collapsed.has(node.key))
        node.children.forEach(visit);
    };
    this.roots.forEach(visit);
  }
  groups() {
    const result = [];
    const visit = (n) => {
      if (n.children) {
        result.push(n);
        n.children.forEach(visit);
      }
    };
    this.roots.forEach(visit);
    return result;
  }
  messagesFor(node) {
    return !node
      ? []
      : node.children
        ? node.children.flatMap((n) => this.messagesFor(n))
        : [node];
  }
  resolveSelection(indices) {
    const unique = new Map();
    for (const i of indices)
      for (const m of this.messagesFor(this.rows[i])) unique.set(m.uri, m);
    return [...unique.values()];
  }
  toggle(index) {
    const n = this.rows[index];
    if (!n?.children) return;
    this.collapsed.has(n.key)
      ? this.collapsed.delete(n.key)
      : this.collapsed.add(n.key);
    this.flatten();
  }
  reveal(uri) {
    const target = this.roots
      .flatMap((n) => this.messagesFor(n))
      .find((m) => m.uri === uri);
    if (!target) return -1;
    for (let node = target.parent; node; node = node.parent)
      this.collapsed.delete(node.key);
    this.flatten();
    return this.rows.findIndex((r) => r.uri === uri);
  }
};
