# ResearchDesk island component 0.7.2

Upstream: Daozai 0.6.64, pinned commit 6eb33732f9b2150e02eef1b1f824b0c087a2c5f2.
Original MIT and third-party notices remain in this source and are bundled by ResearchDesk.

ResearchDesk starts this component with DAOZAI_RESEARCHDESK=1 and an independent DAOZAI_DATA_DIR.
Inherited stdin/stdout carries snapshots, bounded commands, acknowledgements and shutdown.
Go remains authoritative for shared task identity, fixed PDF provenance, elapsed time and completion.
Parent EOF exits the component. Integrated mode bypasses standalone tray/mutex/update/autostart entry points
and does not automatically discover AI accounts. The standalone Daozai profile is never reused.

Original themes, materials and animation are preserved. A fresh integrated profile defaults to GlassLight.
The integrated todo page reads important dates and daily occurrences from Go and supports completion,
reopening and paging. Reading/focus and private todos remain under More.

Settings now use React controls in the workbench, not a hosted native child window. Electron's public
native host IPC/preload entry has been removed. Integrated settings_ui returns without opening a viewport.
The old internal settings_host source remains for historical compatibility, but is not the product UI.
web_settings.rs handles the private settings API; assets/researchdesk-fields.json is shared with React
and used to validate the editable key allowlist, types, options and ranges. A configuration SHA-256
revision rejects stale edits before persistence. Snapshots omit credentials.

Native mail, calendar, quota, weather and notification services still perform their original operations.
web_quota.inc.rs lives in quota_ui's module so those existing connection helpers and completion handlers
are reused rather than duplicated. OS credential storage remains native. Browser/system authorization
can still display its necessary external prompt. Starting with the widget disabled permits settings-only
operation; leaving settings stops that process. Optional installation can omit this executable entirely.
Login startup targets the parent product.

The optional researchdesk-preview binary is a development acceptance artifact, never shipped.
System DWM blur, real third-party account connections and multi-monitor DPI require separate acceptance.
Expanded panels now have full-height side navigation rails within the reserved gutters, with centered arrows and hover/press feedback. Existing page order and hidden-module navigation are preserved. The --navigation preview mode drives real egui pointer input at rail corners without opening a native window.
See ../../REACT-SETTINGS-FIX-0.7.1.md, ../../ISLAND-NAVIGATION-0.7.2.md and ../../RELEASE-0.7.2.md for implementation and validation.
The Windows development build uses GNU; the upstream MSVC path remains available.
