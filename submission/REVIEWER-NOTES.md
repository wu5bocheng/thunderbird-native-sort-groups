# Reviewer notes — 0.4.0

## Submission status and policy

Prepared for ATN, not submitted or approved. The current upstream Thunderbird webext-linter rejects the custom `nativeGroups` Experiment with `experiment-not-allowed`: new custom Experiment submissions are temporarily not accepted, except unmodified published API drafts. This extension is not such a draft. Do not represent a local `--allow-experiments` diagnostic run as acceptance by ATN.

Official sources:
- https://github.com/thunderbird/webext-linter/blob/main/assets/registry.yaml
- https://thunderbird.topicbox.com/groups/addons/T6ff545fb6d479da5/temporary-pause-on-new-experiment-api-add-on-reviews
- https://thunderbird.github.io/atn-review-policy/
- https://addons-reviewer-guide.thunderbird.net/add-on-review-guide

The publisher must resolve this policy requirement with the Thunderbird team before claiming official listing eligibility. Existing stable MailExtension APIs cannot express this arbitrary native nested grouping. Removing the Experiment would require reducing or changing the native integration functionality.

## Scope and architecture

Supported Thunderbird 158.x; tested 158.0.1 on Linux. No external account or credentials needed: use local folders with synthetic mail. Full application permission is disclosed in the listing and privacy policy. `nativeGroups.start(messages, locale)` and `toggle()` are the entire Experiment surface. The former accepts strings resolved by the standard i18n API, plus the UI locale.

`native/implementation.js` registers a hidden native domain column, patches the native sort menus, and installs a presentation adapter over the existing DB view. `native/tree-model.js` contains the pure sort/group/selection model. Selection maps recursively to unique real message headers by URI and invokes native readers/summaries/commands. Mutations are user initiated, delegated to native commands and undo. Messages are not moved merely to group them. Domain grouping uses Services.eTLD, retaining full addresses for public email providers. Shutdown restores menus/handlers/views and removes the owned custom column. Sort preferences are retained locally as disclosed.

The build concatenates tree-model.js and implementation.js into the packaged implementation, avoiding untrusted JAR subscript loads. The standalone model is not also shipped. No third-party code, remote code, minification or build downloads. Python 3 standard library, fixed ZIP metadata; run `python3 build.py` from the source root, generating the XPI one directory above it. The manifest ID is retained for existing local users; its email-style identifier is not a support address.

## Manual verification

1. Install in a clean Thunderbird 158.x profile. Create a Local Folders folder with messages from news@offers.example.com, news@news.example.com, alice@gmail.com and bob@gmail.com on multiple days.
2. Open the native Sort menu. If threaded mode is active, click Date to enter combination sorting. Select Date, then Sender domain. Check numbered checkbox feedback and remove/add fields to change priority.
3. Enable Grouped by Sort; date headers appear collapsed. Click a date title: native right summary must contain its entire scope. Expand the arrow, then click example.com: summary must contain the two business-domain messages. Gmail addresses must remain distinct. Open arrows via mouse and left/right keyboard.
4. Try up to 16 fields, disable grouping to return to flat sorted messages, change direction, reopen the menu and confirm real checks/numbers. Settings persist per folder.
5. Select overlapping parent and child groups with Ctrl; real messages must not be duplicated. Click a leaf and summary entry to read normally.
6. Verify read, stars, tags and junk; delete a group then undo, move it then undo, archive it then undo. Only selected headers may change. Native confirmations and account defaults remain in use.
7. Add a new message, apply Quick Filter (including zero hits), use a cross-folder unread saved search, switch folders, cards/table and native threaded mode. Disable the add-on and verify native handlers/menu state return.

Automated equivalent: `node --test tests/model.test.mjs tests/locales.test.mjs`; `python3 tests/native_integration.py --binary /absolute/path/to/thunderbird`. It drives actual WebDriver pointer/key events in a new temporary profile with synthetic local messages. Chinese run additionally takes `--locale zh-CN --langpack /path/to/official/matching/zh-CN.xpi`. Does not use existing mail profiles. English and Chinese full runs passed; the other five catalogs have automated key/value/metadata and stable group identity checks, not human linguistic review.

Known limits: no message-list drag moving; watch/ignore-thread, whole-thread marking/selecting/navigation and select-flagged disabled in adapter. Native move menu and threaded mode remain available. No real IMAP outage/concurrency or other major-version validation. No ad filtering or deduplication feature in this extension.

## Listing screenshots

Use ATN’s dedicated screenshot fields (not external links inside the description). All PNGs show actual native Thunderbird 1280×800 with generated test mail. `preview-native.png`: date/domain with native summary; `preview-multilevel.png`: four levels. `*-zh-CN.png` shows the same functions with the official matching Chinese language pack. WebDriver does not capture separate native popup widgets; the multi-level screenshot is not claimed to show the Sort popup.

No private mailbox screenshots or credentials are included.
