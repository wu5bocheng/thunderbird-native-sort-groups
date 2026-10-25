/* SPDX-License-Identifier: MPL-2.0 */
// Resolve extension strings through Thunderbird’s standard WebExtension i18n API.
const keys = [
  "senderDomain",
  "sortTooltip",
  "future",
  "today",
  "yesterday",
  "week",
  "fortnight",
  "older",
  "none",
  "flagged",
  "unflagged",
  "read",
  "unread",
  "junk",
  "notJunk",
  "attachments",
  "noAttachments",
  "noTags",
  "unknownSource",
  "mailChanged",
  "viewChanged",
  "commandUnsupported",
  "interfaceUnsupported",
];
const messages = Object.fromEntries(
  keys.map((key) => [key, browser.i18n.getMessage(key)]),
);
browser.nativeGroups.start(messages, browser.i18n.getUILanguage());
browser.browserAction.onClicked.addListener(() =>
  browser.nativeGroups.toggle(),
);
