# Privacy policy — Native Sort & Groups

This add-on processes message headers locally inside Thunderbird to sort messages and build groups. Header data includes sender/recipient addresses and names, subject, dates, size, status, tags, junk classification and attachment flags. It passes selected native message headers to Thunderbird’s built-in reader, summaries and mail commands. It does not transmit mail data to its developer or a third-party service.

The add-on makes no network requests, collects no telemetry and loads no remote code. User-triggered mail operations such as marking, moving or deleting messages use Thunderbird’s existing account configuration and may synchronize to the mail server in the usual way.

Folder URIs and selected sort fields, direction and grouping preferences are saved locally in the Thunderbird preference `extensions.nativeDateDomainGroups.sortConfigs`. They persist after disabling or uninstalling the add-on so that settings can be restored on reinstallation. Users may reset that preference through Thunderbird’s Config Editor to remove them. Message headers, selection and expansion state used by the add-on are held in memory and are not exported into a separate database.

The Experiment API gives the add-on unrestricted access to Thunderbird internals; this access is used for native message-list, selection, menu and command integration. No external AI, analytics, advertisements or monetization are included.

The optional homepage and support links open GitHub only when the user chooses to visit them. GitHub’s own privacy policy then applies. Please avoid posting private mail or credentials in public support issues.

Maintainer: wu5bocheng. Support: https://github.com/wu5bocheng/thunderbird-native-sort-groups/issues
