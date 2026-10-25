/* SPDX-License-Identifier: MPL-2.0 */
/* Thunderbird 158 only. Uses the native TreeView, card/table row renderers and
 * message database headers. Mail operations are delegated to native commands. */
var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs",
);
var { setInterval, clearInterval, setTimeout, clearTimeout } =
  ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
var nativeGroups = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    this.context = context;
    return {
      nativeGroups: {
        start: async (messages, locale) => this.start(messages, locale),
        toggle: async () => this.toggle(),
      },
    };
  }
  start(messages, locale) {
    this.messages = messages;
    this.locale = locale;
    if (this.timer) return;
    this.Model = NativeGroupModel;
    this.fields = NativeSortFields;
    this.states = new Map();
    this.originalFlags = new Map();
    this.paneMemory = new WeakMap();
    this.menuRecords = new Map();
    this.topMenuPatches = new Map();
    this.enabled = true;
    try {
      this.configs = JSON.parse(
        Services.prefs.getStringPref(
          "extensions.nativeDateDomainGroups.sortConfigs",
          "{}",
        ),
      );
    } catch {
      this.configs = {};
    }
    const { ThreadPaneColumns } = ChromeUtils.importESModule(
      "chrome://messenger/content/ThreadPaneColumns.mjs",
    );
    this.columns = ThreadPaneColumns;
    this.ownsColumn = !ThreadPaneColumns.getCustomColumns().some(
      (c) => c.id === "nativeDomainCol",
    );
    if (this.ownsColumn)
      ThreadPaneColumns.addCustomColumn("nativeDomainCol", {
        name: this.messages.senderDomain,
        sortable: true,
        hidden: true,
        textCallback: (hdr) => this.source(hdr.mime2DecodedAuthor),
      });
    this.tick = () => {
      for (const top of Services.wm.getEnumerator("mail:3pane")) {
        this.addMenu(top);
        const pane = this.activePane(top);
        if (
          !pane?.threadTree ||
          !pane.gViewWrapper?.dbView ||
          !pane.gFolder ||
          !pane.dbViewWrapperListener?.allMessagesLoaded
        )
          continue;
        let state = this.states.get(pane);
        if (state && state.wrapper.dbView !== state.proxy) {
          state.dispose(false);
          this.states.delete(pane);
          state = null;
        }
        const config = this.configFor(pane);
        if (this.enabled && !config.threaded && !state) {
          try {
            this.states.set(pane, this.attach(pane));
          } catch (error) {
            try {
              pane.__nativeDateDomainRollback?.();
            } catch {}
            console.error("Native sorting:", error);
            this.enabled = false;
          }
        }
      }
      for (const [pane, state] of this.states)
        if (pane.closed) {
          state.dispose(false);
          this.states.delete(pane);
        }
      this.updateMenus();
    };
    this.timer = setInterval(this.tick, 700);
    this.tick();
  }
  activePane(top) {
    return top.document.getElementById("tabmail")?.currentTabInfo?.chromeBrowser
      ?.contentWindow;
  }
  configFor(pane) {
    const uri = pane.gFolder?.URI;
    if (!uri || !pane.gViewWrapper) return null;
    if (!this.configs[uri]) {
      const wrapper = pane.gViewWrapper;
      const primary = wrapper.primarySortColumnId;
      this.configs[uri] = {
        keys: [this.fields.some((f) => f.id === primary) ? primary : "dateCol"],
        grouped: !!wrapper.showGroupedBySort,
        order: wrapper.isSortedAscending ? "ascending" : "descending",
        threaded: !!wrapper.showThreaded,
      };
    }
    const config = this.configs[uri],
      state = this.states.get(pane);
    if (
      config.threaded &&
      (!state || state.proxy !== pane.gViewWrapper.dbView)
    ) {
      const primary = pane.gViewWrapper.primarySortColumnId;
      if (this.fields.some((f) => f.id === primary)) config.keys = [primary];
      config.order = pane.gViewWrapper.isSortedAscending
        ? "ascending"
        : "descending";
    }
    return config;
  }
  saveConfigs() {
    Services.prefs.setStringPref(
      "extensions.nativeDateDomainGroups.sortConfigs",
      JSON.stringify(this.configs),
    );
  }
  change(pane, changes) {
    const before = this.configFor(pane);
    if (!before) return;
    const next = { ...before, ...changes };
    next.keys = [...new Set(next.keys)].filter((id) =>
      this.fields.some((f) => f.id === id),
    );
    if (!next.keys.length) return;
    const state = this.states.get(pane);
    if (state && state.wrapper.dbView === state.proxy) state.configure(next);
    this.configs[pane.gFolder.URI] = next;
    this.saveConfigs();
    this.enabled = true;
    this.tick();
    pane.threadPane.restoreSortIndicator();
    this.updateMenus();
  }
  selectField(pane, id) {
    const config = this.configFor(pane);
    if (!config) return;
    const keys = [...config.keys],
      index = keys.indexOf(id);
    if (index < 0) keys.push(id);
    else if (keys.length > 1) keys.splice(index, 1);
    this.change(pane, { keys, threaded: false });
  }
  toggle() {
    const top = Services.wm.getMostRecentWindow("mail:3pane"),
      pane = top && this.activePane(top);
    const config = pane?.gFolder && this.configFor(pane);
    if (config)
      this.change(pane, { grouped: !config.grouped, threaded: false });
  }
  nativeMode(pane, original, args) {
    const state = this.states.get(pane);
    if (state) {
      state.dispose(true);
      this.states.delete(pane);
    }
    this.originalFlags.delete(pane.gFolder.URI);
    const config = this.configFor(pane);
    config.threaded = true;
    config.grouped = false;
    const result = original.apply(pane.sortController, args);
    const primary = pane.gViewWrapper.primarySortColumnId;
    if (this.fields.some((f) => f.id === primary)) config.keys = [primary];
    config.order = pane.gViewWrapper.isSortedAscending
      ? "ascending"
      : "descending";
    this.saveConfigs();
    this.updateMenus();
    return result;
  }
  addMenu(top) {
    if (
      !this.topMenuPatches.has(top) &&
      typeof top.goUpdateThreadPaneSortMenu === "function"
    ) {
      const original = top.goUpdateThreadPaneSortMenu,
        owner = this;
      top.goUpdateThreadPaneSortMenu = function (wrapper, popup) {
        const result = original.call(this, wrapper, popup);
        owner.syncMenu(popup, top);
        return result;
      };
      this.topMenuPatches.set(top, original);
    }
    for (const doc of [top.document, this.activePane(top)?.document].filter(
      Boolean,
    ))
      for (const popup of doc.querySelectorAll("menupopup")) {
        if (
          !/sort/i.test(popup.id) ||
          this.menuRecords.has(popup) ||
          ![...popup.children].some((i) => i.getAttribute("value") === "byDate")
        )
          continue;
        const entries = [];
        for (const item of popup.children) {
          const field = this.fields.find(
            (f) => f.sortKey === item.getAttribute("value"),
          );
          if (field || item.getAttribute("value") === "groupedBySort") {
            const attrs = {};
            for (const name of [
              "label",
              "type",
              "name",
              "autocheck",
              "closemenu",
              "tooltiptext",
              "checked",
              "disabled",
            ])
              attrs[name] = item.getAttribute(name);
            entries.push({ item, field, attrs });
            item.setAttribute("autocheck", "false");
            item.setAttribute("type", "checkbox");
            item.removeAttribute("name");
            if (field) {
              item.setAttribute("type", "checkbox");
              item.removeAttribute("name");
              item.setAttribute("closemenu", "none");
              item.setAttribute("tooltiptext", this.messages.sortTooltip);
            }
          }
        }
        const domain = doc.createXULElement("menuitem");
        domain.setAttribute("label", this.messages.senderDomain);
        domain.setAttribute("value", "byNativeDomain");
        domain.setAttribute("type", "checkbox");
        domain.setAttribute("autocheck", "false");
        domain.setAttribute("closemenu", "none");
        domain.dataset.nativeSortField = "nativeDomainCol";
        const from = [...popup.children].find(
          (i) => i.getAttribute("value") === "byAuthor",
        );
        if (from) from.after(domain);
        else popup.append(domain);
        entries.push({
          item: domain,
          field: this.fields.find((f) => f.id === "nativeDomainCol"),
          created: true,
          attrs: { label: this.messages.senderDomain },
        });
        const onCommand = (event) => {
          const pane = this.activePane(top);
          if (!pane?.gFolder) return;
          const value = event.target.getAttribute("value"),
            field = this.fields.find((f) => f.sortKey === value),
            config = this.configFor(pane);
          if (!config) return;
          if (
            field ||
            ["groupedBySort", "ascending", "descending", "unthreaded"].includes(
              value,
            )
          ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (field) this.selectField(pane, field.id);
            else if (value === "groupedBySort")
              this.change(pane, { grouped: !config.grouped, threaded: false });
            else if (value === "unthreaded")
              this.change(pane, { grouped: false, threaded: false });
            else this.change(pane, { order: value });
          }
        };
        const showing = () => this.syncMenu(popup, top);
        popup.addEventListener("command", onCommand, true);
        popup.addEventListener("popupshowing", showing);
        this.menuRecords.set(popup, { top, entries, onCommand, showing });
        this.syncMenu(popup, top);
      }
  }
  syncMenu(popup, top) {
    if (!this.menuRecords.has(popup)) return;
    const pane = this.activePane(top);
    if (!pane?.gFolder) return;
    const record = this.menuRecords.get(popup),
      state = this.states.get(pane);
    let config =
      state && pane.gViewWrapper && state.proxy === pane.gViewWrapper.dbView
        ? state.config
        : this.configFor(pane);
    if (
      config?.threaded &&
      (!state || state.proxy !== pane.gViewWrapper?.dbView)
    )
      config = {
        ...config,
        grouped: !!pane.gViewWrapper.showGroupedBySort,
        threaded: !!pane.gViewWrapper.showThreaded,
      };
    if (!config) return;
    for (const { item, field, attrs } of record.entries) {
      if (field) {
        const rank = config.keys.indexOf(field.id);
        item.toggleAttribute("checked", rank >= 0);
        item.setAttribute(
          "label",
          rank >= 0 ? `${rank + 1} · ${attrs.label}` : attrs.label,
        );
      } else {
        item.removeAttribute("disabled");
        item.toggleAttribute("checked", config.grouped && !config.threaded);
      }
    }
    for (const item of popup.children) {
      const value = item.getAttribute("value");
      if (["ascending", "descending"].includes(value))
        item.toggleAttribute("checked", config.order === value);
      if (value === "threaded")
        item.toggleAttribute("checked", config.threaded);
      if (value === "unthreaded")
        item.toggleAttribute("checked", !config.grouped && !config.threaded);
    }
  }
  updateMenus() {
    for (const [popup, record] of this.menuRecords)
      if (popup.isConnected) this.syncMenu(popup, record.top);
  }
  extractFields(hdr, index, raw, keys) {
    const wanted = keys.filter(
      (id) => !["dateCol", "receivedCol", "nativeDomainCol"].includes(id),
    );
    const labels = wanted.length
      ? raw.cellDataForColumns(index, wanted, {}, {})
      : [];
    const result = {};
    for (let i = 0; i < wanted.length; i++) {
      const id = wanted[i];
      let value,
        label = labels[i] || "";
      switch (id) {
        case "senderCol":
          value = hdr.mime2DecodedAuthor;
          label = label || value;
          break;
        case "recipientCol":
          value = hdr.mime2DecodedRecipients;
          label = label || value;
          break;
        case "subjectCol":
          value = hdr.mime2DecodedSubject;
          label = label || value;
          break;
        case "idCol":
          value = hdr.messageKey;
          label = String(value);
          break;
        case "sizeCol":
          value = hdr.messageSize;
          label = `${value} B`;
          break;
        case "priorityCol":
          value = hdr.priority;
          label = label || String(value);
          break;
        case "flaggedCol":
          value = Number(hdr.isFlagged);
          label = value ? this.messages.flagged : this.messages.unflagged;
          break;
        case "unreadButtonColHeader":
          value = Number(hdr.isRead);
          label = value ? this.messages.read : this.messages.unread;
          break;
        case "junkStatusCol":
          value = Number(hdr.getStringProperty("junkscore")) >= 50 ? 1 : 0;
          label = value ? this.messages.junk : this.messages.notJunk;
          break;
        case "attachmentCol":
          value = Number(!!(hdr.flags & Ci.nsMsgMessageFlags.Attachment));
          label = value
            ? this.messages.attachments
            : this.messages.noAttachments;
          break;
        case "tagsCol":
          value = hdr
            .getStringProperty("keywords")
            .split(/\s+/)
            .filter(Boolean)
            .sort()
            .join(" ");
          label = label || value || this.messages.noTags;
          break;
        default:
          value = label;
          break;
      }
      result[id] = {
        key: value ?? "",
        value: value ?? "",
        label: label || this.messages.none,
      };
    }
    return result;
  }
  source(author) {
    const match = author.match(/<([^<>]+)>/),
      email = (
        match?.[1] ||
        author.match(/[^\s<>"(),;]+@[^\s<>"(),;]+/)?.[0] ||
        author
      )
        .trim()
        .toLowerCase();
    const at = email.lastIndexOf("@");
    if (at < 0) return email || this.messages.unknownSource;
    let domain = email.slice(at + 1),
      base = domain;
    try {
      domain = Services.io.newURI("https://" + domain).host;
      base = Services.eTLD.getBaseDomainFromHost(domain);
    } catch {}
    const publicProviders = new Set(
      "gmail.com googlemail.com outlook.com hotmail.com live.com msn.com yahoo.com yahoo.co.uk yahoo.co.jp ymail.com aol.com icloud.com me.com mac.com proton.me protonmail.com pm.me qq.com foxmail.com 163.com 126.com yeah.net mail.com gmx.com gmx.de web.de fastmail.com hey.com".split(
        " ",
      ),
    );
    return publicProviders.has(domain) || publicProviders.has(base)
      ? email
      : base;
  }
  attach(pane) {
    const owner = this,
      wrapper = pane.gViewWrapper,
      folder = wrapper.displayedFolder;
    let config = {
      ...owner.configFor(pane),
      keys: [...owner.configFor(pane).keys],
    };
    const savedFlags = this.originalFlags.get(folder.URI) ?? wrapper._viewFlags;
    this.originalFlags.set(folder.URI, savedFlags);
    const restoreFolderFlags = () => {
      try {
        folder.msgDatabase.dBFolderInfo.viewFlags = savedFlags;
      } catch {}
    };
    const memories = this.paneMemory.get(pane) || new Map();
    this.paneMemory.set(pane, memories);
    const memory = memories.get(folder.URI) || {
      collapsed: new Set(),
      seen: new Set(),
      selected: [],
      focus: null,
    };
    memories.set(folder.URI, memory);
    wrapper.showUnthreaded = true;
    const raw = wrapper.dbView,
      tree = pane.threadTree,
      DUMMY = 0x20000000,
      NONE = 0xffffffff;
    const groupedAttribute = tree.dataset.showGroupedBySort;
    const { TreeSelection } = ChromeUtils.importESModule(
      "chrome://messenger/content/TreeSelection.mjs",
    );
    const realSelection = new TreeSelection();
    realSelection.view = raw;
    realSelection.selectEventsSuppressed = true;
    let model,
      proxy,
      selection = null,
      disposed = false,
      rebuilding = false,
      syncing = false,
      timer = null,
      dirty = false,
      batch = 0;
    let nextMessageURI = null,
      lastDisplaySignature = null;
    const cleanups = [];
    const patch = (object, name, replacement) => {
      const original = object[name];
      object[name] = replacement(original);
      cleanups.push(() => {
        object[name] = original;
      });
    };
    const selectedIndices = () => {
      const result = [];
      if (!selection) return result;
      for (let range = 0; range < selection.getRangeCount(); range++) {
        const lo = {},
          hi = {};
        selection.getRangeAt(range, lo, hi);
        for (let i = lo.value; i <= hi.value; i++)
          if (model?.rows[i]) result.push(i);
      }
      return result;
    };
    const selectedKeys = () => selectedIndices().map((i) => model.rows[i].key);
    const selectedMessages = () =>
      model ? model.resolveSelection(selectedIndices()) : [];
    const rowAt = (i) => model?.rows[i];
    const leavesOf = (row) => model?.messagesFor(row) || [];
    const nativeIndex = (message, strict = true) => {
      const index = raw.findIndexOfMsgHdr(message.hdr, false);
      if (index === NONE || index < 0) {
        if (strict) throw new Error(owner.messages.mailChanged);
        return -1;
      }
      return index;
    };
    const rowIndex = (i) => {
      const row = rowAt(i);
      if (!row) throw new Error("Invalid message row");
      return nativeIndex(row.children ? leavesOf(row)[0] : row);
    };
    const synchronize = (messages = selectedMessages(), strict = false) => {
      if (disposed || syncing) return;
      // Resolve every header before changing native selection: fail without a partial command.
      const indices = messages
        .map((message) => nativeIndex(message, strict))
        .filter((index) => index >= 0);
      syncing = true;
      try {
        raw.selection = realSelection;
        realSelection.clearSelection();
        for (const index of indices)
          realSelection.rangedSelect(index, index, true);
        realSelection.currentIndex = indices[0] ?? -1;
      } finally {
        syncing = false;
      }
    };
    const capture = () => {
      if (!selection) return;
      memory.selected = selectedKeys();
      memory.focus = rowAt(selection?.currentIndex)?.key ?? null;
    };
    const restoreSelection = () => {
      if (!selection) return;
      selection.selectEventsSuppressed = true;
      selection.clearSelection();
      const byKey = new Map(model.rows.map((r, i) => [r.key, i]));
      for (const key of memory.selected) {
        const index = byKey.get(key);
        if (index !== undefined) selection.rangedSelect(index, index, true);
      }
      selection.currentIndex = byKey.get(memory.focus) ?? -1;
      selection.selectEventsSuppressed = false;
      tree.invalidate();
      tree._updateCurrentIndexClasses();
    };
    const notifySelection = () => {
      if (disposed || rebuilding) return;
      synchronize();
      capture();
      tree.onSelectionChanged(false, false);
    };
    const invalidateChange = (previousRows) => {
      const before = previousRows.map((r) => r.key),
        after = model.rows.map((r) => r.key);
      let prefix = 0;
      while (
        prefix < before.length &&
        prefix < after.length &&
        before[prefix] === after[prefix]
      )
        prefix++;
      const delta = after.length - before.length;
      if (delta) tree.rowCountChanged(prefix, delta);
      tree.invalidate();
      // Reset only when the row count changes, to update virtual spacers and the row buffer.
      if (delta) tree.reset();
    };
    const rebuild = (announce = true) => {
      if (disposed || rebuilding) return;
      rebuilding = true;
      clearTimeout(timer);
      dirty = false;
      const previous = model?.rows || [];
      const topIndex = tree.getFirstVisibleIndex?.() ?? 0,
        anchor = previous[topIndex]?.key;
      const rowHeight = tree._rowElementClass?.ROW_HEIGHT || 46,
        offset = tree.scrollTop - topIndex * rowHeight;
      if (selection) capture();
      const messages = [];
      try {
        for (let i = 0; i < raw.rowCount; i++) {
          if (raw.getFlagsAt(i) & DUMMY) continue;
          const hdr = raw.getMsgHdrAt(i);
          if (hdr)
            messages.push({
              hdr,
              index: i,
              uri: hdr.folder.getUriForMsg(hdr),
              date: hdr.dateInSeconds * 1000,
              received:
                (hdr.getUint32Property("dateReceived") || hdr.dateInSeconds) *
                1000,
              author: hdr.mime2DecodedAuthor,
              read: hdr.isRead,
              sortFields: owner.extractFields(hdr, i, raw, config.keys),
            });
        }
        model = new owner.Model(
          messages,
          (a) => owner.source(a),
          memory.collapsed,
          new Date(),
          memory.seen,
          { ...config, labels: owner.messages, locale: owner.locale },
        );
        if (selection) {
          selection.selectEventsSuppressed = true;
          selection.clearSelection();
        }
        if (proxy && wrapper.dbView === proxy) {
          tree.dataset.showGroupedBySort = String(config.grouped);
          invalidateChange(previous);
          restoreSelection();
          if (anchor) {
            const i = model.rows.findIndex((r) => r.key === anchor);
            if (i >= 0) tree.scrollTop = Math.max(0, i * rowHeight + offset);
          }
        }
      } finally {
        rebuilding = false;
      }
      if (announce && proxy && wrapper.dbView === proxy) notifySelection();
    };
    const changed = () => {
      if (!disposed) {
        dirty = true;
        clearTimeout(timer);
        if (!batch) timer = setTimeout(() => rebuild(), 25);
      }
    };
    const notify = {
      QueryInterface: ChromeUtils.generateQI(["nsIMsgJSTree"]),
      beginUpdateBatch() {
        batch++;
      },
      endUpdateBatch() {
        batch = Math.max(0, batch - 1);
        if (!batch) changed();
      },
      invalidate: changed,
      invalidateRange: changed,
      rowCountChanged: changed,
      ensureRowIsVisible(index) {
        const hdr = raw.getMsgHdrAt(index);
        const i = hdr
          ? model.rows.findIndex((r) => r.uri === hdr.folder.getUriForMsg(hdr))
          : -1;
        if (i >= 0) tree.scrollToIndex(i);
      },
      get currentIndex() {
        return realSelection.currentIndex;
      },
      set currentIndex(value) {
        realSelection.currentIndex = value;
      },
    };
    const reveal = (uri) => {
      const previous = model.rows.slice(),
        index = model.reveal(uri);
      if (index < 0) return NONE;
      if (previous.length !== model.rows.length) invalidateChange(previous);
      return index;
    };
    const command = (method, args, messages) => {
      if (disposed || wrapper.dbView !== proxy)
        throw new Error(owner.messages.viewChanged);
      if (dirty && !messages) rebuild(false);
      synchronize(messages, true);
      try {
        return raw[method](...args);
      } finally {
        changed();
      }
    };
    const types = Ci.nsMsgViewCommandType;
    const supportedCommands = new Set(
      [
        "markMessagesRead",
        "markMessagesUnread",
        "toggleMessageRead",
        "flagMessages",
        "unflagMessages",
        "junk",
        "unjunk",
        "deleteMsg",
        "deleteNoTrash",
        "moveMessages",
        "copyMessages",
        "markAllRead",
        "downloadSelectedForOffline",
        "downloadFlaggedForOffline",
      ]
        .map((name) => types[name])
        .filter((value) => value !== undefined),
    );
    const adapter = {
      get rowCount() {
        return model?.rows.length || 0;
      },
      get selection() {
        return selection;
      },
      set selection(value) {
        if (selection && !value) capture();
        selection = value;
      },
      setTree() {},
      setJSTree(value) {
        raw.setJSTree(value ? notify : null);
      },
      selectionChanged() {
        if (!rebuilding) {
          synchronize();
          capture();
          raw.selectionChanged();
        }
      },
      getLevel: (i) => rowAt(i)?.level || 0,
      getParentIndex: (i) => {
        const parent = rowAt(i)?.parent;
        return parent ? model.rows.indexOf(parent) : -1;
      },
      isContainer: (i) => !!rowAt(i)?.children,
      isContainerOpen: (i) =>
        !!rowAt(i)?.children && !memory.collapsed.has(rowAt(i).key),
      isContainerEmpty: (i) => !rowAt(i)?.children?.length,
      isSeparator: () => false,
      isSorted: () => true,
      hasNextSibling: (i, after) => {
        const row = rowAt(i);
        for (let n = after + 1; n < model.rows.length; n++) {
          if (model.rows[n].level < row.level) return false;
          if (model.rows[n].level === row.level) return true;
        }
        return false;
      },
      toggleOpenState: (i) => {
        model.toggle(i);
        capture();
      },
      getFlagsAt: (i) =>
        rowAt(i)?.children
          ? DUMMY |
            (memory.collapsed.has(rowAt(i).key)
              ? Ci.nsMsgMessageFlags.Elided
              : 0)
          : rowAt(i)?.hdr.flags || 0,
      cellDataForColumns: (i, columns, properties, level) => {
        const row = rowAt(i);
        if (!row) return columns.map(() => "");
        if (!row.children) {
          const native = nativeIndex(row, false);
          if (native < 0) {
            properties.value = "";
            level.value = row.level;
            return columns.map(() => "");
          }
          const result = raw.cellDataForColumns(
            native,
            columns,
            properties,
            level,
          );
          level.value = row.level;
          properties.value +=
            " native-sort-leaf native-sort-level-" + row.level;
          return result;
        }
        properties.value =
          "dummy native-sort-group native-sort-level-" + row.level;
        level.value = row.level;
        return columns.map((c) =>
          c === "subjectCol"
            ? row.label
            : c === "totalCol"
              ? String(row.count)
              : c === "unreadCol"
                ? String(row.unread)
                : "",
        );
      },
      getSelectedMsgHdrs: () => selectedMessages().map((m) => m.hdr),
      getURIsForSelection: () => selectedMessages().map((m) => m.uri),
      get numSelected() {
        return selectedMessages().length;
      },
      get hdrForFirstSelectedMessage() {
        return selectedMessages()[0]?.hdr || null;
      },
      get URIForFirstSelectedMessage() {
        return selectedMessages()[0]?.uri || null;
      },
      get viewIndexForFirstSelectedMsg() {
        let node = selectedMessages()[0];
        while (node) {
          const i = model.rows.indexOf(node);
          if (i >= 0) return i;
          node = node.parent;
        }
        return NONE;
      },
      get indicesForSelection() {
        return selectedIndices();
      },
      findIndexForMsgURI: (uri, expand) => {
        if (expand) return reveal(uri);
        const i = model.rows.findIndex((r) => r.uri === uri);
        return i < 0 ? NONE : i;
      },
      findIndexOfMsgHdr: (hdr, expand) =>
        adapter.findIndexForMsgURI(hdr.folder.getUriForMsg(hdr), expand),
      getCommandStatus: (type) => {
        if (!supportedCommands.has(type)) return false;
        try {
          synchronize();
          return raw.getCommandStatus(type);
        } catch {
          return false;
        }
      },
      doCommand: (type) => {
        if (type === types.expandAll || type === types.collapseAll) {
          const expand = type === types.expandAll,
            previous = model.rows.slice();
          for (const group of model.groups())
            expand
              ? memory.collapsed.delete(group.key)
              : memory.collapsed.add(group.key);
          model.flatten();
          invalidateChange(previous);
          return;
        }
        if (!supportedCommands.has(type))
          throw new Error(owner.messages.commandUnsupported);
        return command("doCommand", [type]);
      },
      doCommandWithFolder: (type, destination) => {
        if (type !== types.moveMessages && type !== types.copyMessages)
          throw new Error("Unsupported folder command");
        return command("doCommandWithFolder", [type, destination]);
      },
      applyCommandToIndices: (type, indices) => {
        if (!supportedCommands.has(type))
          throw new Error("Unsupported indexed command");
        const messages = model.resolveSelection(indices),
          nativeIndices = messages.map((message) => nativeIndex(message));
        return command(
          "applyCommandToIndices",
          [type, nativeIndices],
          messages,
        );
      },
      get msgToSelectAfterDelete() {
        synchronize();
        const i = raw.msgToSelectAfterDelete;
        const hdr = i !== NONE && i >= 0 ? raw.getMsgHdrAt(i) : null;
        nextMessageURI = hdr ? hdr.folder.getUriForMsg(hdr) : null;
        return nextMessageURI
          ? adapter.findIndexForMsgURI(nextMessageURI, false)
          : NONE;
      },
      viewNavigate: (direction, keyOut, indexOut, threadOut, wrap) => {
        const nav = Ci.nsMsgNavigationType;
        const directions = new Map([
          [nav.nextMessage, [1, () => true]],
          [nav.previousMessage, [-1, () => true]],
          [nav.nextUnreadMessage, [1, (m) => !m.hdr.isRead]],
          [nav.previousUnreadMessage, [-1, (m) => !m.hdr.isRead]],
          [nav.nextFlagged, [1, (m) => m.hdr.isFlagged]],
          [nav.previousFlagged, [-1, (m) => m.hdr.isFlagged]],
        ]);
        if (directions.has(direction)) {
          const [step, predicate] = directions.get(direction),
            ordered = model.roots.flatMap((root) => model.messagesFor(root));
          const current = rowAt(selection?.currentIndex),
            members = model.messagesFor(current);
          const uri = current?.children
            ? step > 0
              ? members[0]?.uri
              : members.at(-1)?.uri
            : current?.uri;
          let index = ordered.findIndex((m) => m.uri === uri);
          if (index < 0) index = step > 0 ? -1 : ordered.length;
          if (current?.children) index -= step;
          let target;
          for (let n = 0; n < ordered.length; n++) {
            index += step;
            if (index < 0 || index >= ordered.length) {
              if (!wrap) break;
              index = (index + ordered.length) % ordered.length;
            }
            if (predicate(ordered[index])) {
              target = ordered[index];
              break;
            }
          }
          keyOut.value = target?.hdr.messageKey ?? NONE;
          indexOut.value = target ? reveal(target.uri) : NONE;
          threadOut.value = indexOut.value;
          return;
        }
        synchronize();
        raw.viewNavigate(direction, keyOut, indexOut, threadOut, wrap);
        const hdr =
          indexOut.value !== NONE ? raw.getMsgHdrAt(indexOut.value) : null;
        indexOut.value = hdr ? reveal(hdr.folder.getUriForMsg(hdr)) : NONE;
        threadOut.value = indexOut.value;
      },
      sort: (type, order) => {
        const result = raw.sort(type, order);
        changed();
        return result;
      },
      close: () => {
        capture();
        raw.setJSTree(null);
        raw.close();
        restoreFolderFlags();
      },
    };
    const indexedMethods = new Set([
      "getMsgHdrAt",
      "getURIForViewIndex",
      "getFolderForViewIndex",
      "getKeyAt",
      "getCellProperties",
      "getCellText",
      "getImageSrc",
      "getThreadContainingIndex",
    ]);
    const plainMethods = new Set([
      "QueryInterface",
      "getThreadContainingMsgHdr",
      "addColumnHandler",
      "removeColumnHandler",
      "getColumnHandler",
      "clone",
      "cloneDBView",
      "onDeleteCompleted",
      "getViewType",
      "getSupportedCommandTypes",
    ]);
    proxy = new Proxy(
      {},
      {
        get(_target, key) {
          if (key in adapter) return Reflect.get(adapter, key);
          if (key === "getRowProperties")
            return (i) =>
              rowAt(i)?.children ? "dummy" : raw.getRowProperties(rowIndex(i));
          if (indexedMethods.has(key))
            return (i, ...args) => {
              const message = rowAt(i)?.children
                ? leavesOf(rowAt(i))[0]
                : rowAt(i);
              if (key === "getMsgHdrAt") return message?.hdr || null;
              if (key === "getURIForViewIndex") return message?.uri || null;
              if (key === "getFolderForViewIndex")
                return message?.hdr.folder || null;
              if (key === "getKeyAt") return message?.hdr.messageKey ?? NONE;
              const index = message ? nativeIndex(message, false) : -1;
              return index >= 0 ? raw[key](index, ...args) : null;
            };
          const value = raw[key];
          if (typeof value !== "function") return value;
          if (plainMethods.has(key)) return value.bind(raw);
          return () => {
            throw new Error(owner.messages.interfaceUnsupported + String(key));
          };
        },
        set(_target, key, value) {
          if (key === "selection") {
            selection = value;
            return true;
          }
          if (key === "viewFlags") {
            raw.viewFlags =
              value &
              ~(
                Ci.nsMsgViewFlagsType.kGroupBySort |
                Ci.nsMsgViewFlagsType.kThreadedDisplay
              );
            changed();
            return true;
          }
          raw[key] = value;
          return true;
        },
      },
    );
    pane.__nativeDateDomainRollback = () => {
      wrapper.dbView = raw;
      pane.threadPane.setTreeView(raw);
      wrapper._viewFlags = savedFlags;
    };
    rebuild(false);
    wrapper.dbView = proxy;
    pane.threadPane.setTreeView(proxy);
    raw.selection = realSelection;
    raw.setJSTree(notify);
    tree.dataset.showGroupedBySort = String(config.grouped);
    restoreSelection();
    // Only group selection needs an addition to the native selection handler.
    patch(
      pane.threadPane,
      "_onSelect",
      (original) =>
        function (...args) {
          synchronize();
          capture();
          const messages = selectedMessages(),
            group = selectedIndices().some((i) => rowAt(i)?.children);
          const signature = JSON.stringify([group, messages.map((m) => m.uri)]);
          const visible = group
            ? !pane.multiMessageBrowser.hidden
            : messages.length
              ? !pane.messageBrowser.hidden
              : true;
          if (signature === lastDisplaySignature && visible) {
            pane.threadPaneHeader.updateSelectedCount();
            return;
          }
          lastDisplaySignature = signature;
          if (group) {
            pane.messagePane.displayMessages(messages.map((m) => m.hdr));
            pane.updateZoomCommands();
            pane.threadPaneHeader.updateSelectedCount();
            return;
          }
          return original.apply(this, args);
        },
    );
    patch(
      pane.dbViewWrapperListener,
      "onMessagesRemoved",
      (original) =>
        function (...args) {
          if (dirty) rebuild(false);
          if (selectedIndices().some((i) => rowAt(i)?.children))
            this._nextViewIndexAfterDelete = null;
          else if (nextMessageURI) {
            this._nextViewIndexAfterDelete = reveal(nextMessageURI);
            nextMessageURI = null;
          }
          const result = original.apply(this, args);
          notifySelection();
          return result;
        },
    );
    // Sorting and grouping are independent controls. Native thread mode is still native.
    patch(
      pane.sortController,
      "sortThreadPane",
      (_original) =>
        function (id) {
          owner.change(pane, {
            keys: [id],
            order: "ascending",
            threaded: false,
          });
          return true;
        },
    );
    patch(
      pane.sortController,
      "sortAscending",
      (_original) =>
        function () {
          owner.change(pane, { order: "ascending" });
        },
    );
    patch(
      pane.sortController,
      "sortDescending",
      (_original) =>
        function () {
          owner.change(pane, { order: "descending" });
        },
    );
    patch(
      pane.sortController,
      "reverseSortThreadPane",
      (_original) =>
        function () {
          owner.change(pane, {
            order: config.order === "ascending" ? "descending" : "ascending",
          });
        },
    );
    patch(
      pane.sortController,
      "groupBySort",
      (_original) =>
        function () {
          owner.change(pane, { grouped: true, threaded: false });
        },
    );
    patch(
      pane.sortController,
      "sortUnthreaded",
      (_original) =>
        function () {
          owner.change(pane, { grouped: false, threaded: false });
        },
    );
    for (const name of ["sortThreaded", "sortByThread", "toggleThreaded"]) {
      patch(
        pane.sortController,
        name,
        (original) =>
          function (...args) {
            return owner.nativeMode(pane, original, args);
          },
      );
    }
    if (typeof pane.SwitchView === "function")
      patch(
        pane,
        "SwitchView",
        (original) =>
          function (...args) {
            const state = owner.states.get(pane);
            if (state) {
              state.dispose(true);
              owner.states.delete(pane);
            }
            owner.configFor(pane).threaded = true;
            return original.apply(this, args);
          },
      );
    patch(
      pane.threadPane,
      "restoreThreadState",
      (_original) =>
        function () {
          tree.dataset.showGroupedBySort = String(config.grouped);
        },
    );
    patch(
      pane.threadPane,
      "updateSortIndicator",
      (_original) =>
        function () {
          for (const header of this.treeTable.header.querySelectorAll(
            "[aria-sort]",
          ))
            header.removeAttribute("aria-sort");
          const header = this.treeTable.header.querySelector(
            "#" + config.keys[0],
          );
          if (header) header.ariaSort = config.order;
        },
    );
    patch(
      pane.threadPane,
      "restoreSortIndicator",
      (_original) =>
        function () {
          this.updateSortIndicator();
        },
    );
    patch(
      pane.threadPane,
      "onSortChanged",
      (_original) =>
        function (data) {
          if (config.keys[0] === data.column)
            owner.change(pane, {
              order: config.order === "ascending" ? "descending" : "ascending",
            });
          else owner.change(pane, { keys: [data.column], order: "ascending" });
        },
    );
    // Commands with semantics tied to native conversation threads are disabled individually.
    const unsupported = new Set([
      "cmd_watchThread",
      "cmd_killThread",
      "cmd_killSubthread",
      "cmd_markThreadAsRead",
      "cmd_selectThread",
      "cmd_nextUnreadThread",
      "cmd_selectFlagged",
    ]);
    for (const controller of new Set(
      [
        pane.commandController,
        pane.messageBrowser?.contentWindow?.commandController,
      ].filter(Boolean),
    )) {
      patch(
        controller,
        "isCommandEnabled",
        (original) =>
          function (command, ...args) {
            return unsupported.has(command)
              ? false
              : original.call(this, command, ...args);
          },
      );
      patch(
        controller,
        "doCommand",
        (original) =>
          function (command, ...args) {
            if (unsupported.has(command)) return;
            synchronize();
            return original.call(this, command, ...args);
          },
      );
    }
    // Drag/drop has a separate native index protocol; menus remain available for moving mail.
    const guardDrag = (event) => {
      event.preventDefault();
    };
    tree.addEventListener("dragstart", guardDrag, true);
    cleanups.push(() => tree.removeEventListener("dragstart", guardDrag, true));
    const style = pane.document.createElement("style");
    style.textContent = Array.from(
      { length: owner.fields.length + 1 },
      (_, i) =>
        `tr[data-properties~=native-sort-level-${i}] .card-container{margin-inline-start:${i * 16}px}`,
    ).join("");
    pane.document.head.append(style);
    cleanups.push(() => style.remove());
    const state = {
      wrapper,
      raw,
      proxy,
      get model() {
        return model;
      },
      get config() {
        return { ...config, keys: [...config.keys] };
      },
      refresh: rebuild,
      configure(next) {
        const previous = config;
        config = { ...next, keys: [...next.keys] };
        try {
          rebuild();
        } catch (error) {
          config = previous;
          throw error;
        }
      },
      dispose(restore) {
        if (disposed) return;
        capture();
        disposed = true;
        clearTimeout(timer);
        try {
          raw.setJSTree(null);
        } catch {}
        restoreFolderFlags();
        for (const cleanup of cleanups.reverse()) cleanup();
        delete pane.__nativeDateDomainState;
        delete pane.__nativeDateDomainRollback;
        if (groupedAttribute === undefined)
          delete tree.dataset.showGroupedBySort;
        else tree.dataset.showGroupedBySort = groupedAttribute;
        if (wrapper.dbView === proxy) {
          wrapper.dbView = raw;
          if (restore && !pane.closed) {
            pane.threadPane.setTreeView(raw);
            wrapper._viewFlags = savedFlags;
          }
        }
      },
    };
    pane.__nativeDateDomainState = state;
    notifySelection();
    return state;
  }
  onShutdown() {
    clearInterval(this.timer);
    for (const state of this.states?.values() || [])
      try {
        state.dispose(true);
      } catch {}
    for (const [popup, record] of this.menuRecords || []) {
      popup.removeEventListener("command", record.onCommand, true);
      popup.removeEventListener("popupshowing", record.showing);
      for (const { item, created, attrs } of record.entries) {
        if (created) {
          item.remove();
          continue;
        }
        for (const [name, value] of Object.entries(attrs))
          value === null
            ? item.removeAttribute(name)
            : item.setAttribute(name, value);
      }
    }
    for (const [top, original] of this.topMenuPatches || [])
      if (!top.closed) top.goUpdateThreadPaneSortMenu = original;
    try {
      if (this.ownsColumn) this.columns?.removeCustomColumn("nativeDomainCol");
    } catch {}
    Services.obs.notifyObservers(null, "startupcache-invalidate");
  }
};
