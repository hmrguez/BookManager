# 0016 — Responsive library and reading surfaces

**Status:** Accepted
**Date:** 2026-09-23

## Decision

Preserve the phone navigation and core flows. Use the same adaptive layout on iPad,
Android tablets, and foldables. Available window space and applied text size determine
layout; device identity and posture do not. Device-specific beta APIs and multitasking
workspaces are outside this increment.

| Surface | Wide presentation |
| --- | --- |
| Library | Existing all-shelves overview, with a dismissible book-detail pane after selection |
| Settings | Category navigation beside the selected settings |
| Add-book search | Results beside an explicitly selected edition's details |
| Manual entry | A focused, width-constrained form |
| Import review | Queue beside the selected record, retaining inclusion and remapping decisions |
| Focused actions and audiobook player | Centered dialogs using existing controls |
| EPUB | Two pages when space and typography permit, respecting an explicit one-page preference |
| PDF | Existing single-page reader |
| Reader navigation and annotations | Temporary native overlays, without resizing the publication surface |

The React layout requires at least 900 CSS pixels and 56 root ems in width, plus
480 pixels and 30 root ems in height to retain the phone layout in landscape. Increasing interface
type can therefore collapse a tablet window to the familiar compact layout. Native EPUB
hosts use window width, reading font size, and system text scale. The 960-point/dp baseline
matches Readium CSS's conservative 60em spread threshold; compatibility rules still keep
fixed-layout and vertical-writing publications in their supported layouts. Scroll mode
remains one column. Stored preferences are never rewritten to reflect a temporary fallback.

## State and interaction

The same mounted detail and form instances survive layout changes. A narrow detail pane
becomes the existing modal phone sheet; widening restores nonmodal side-by-side browsing.
Library query, selection, scroll, unsaved metadata, and import decisions survive resizing.
Native Readium retains semantic locations through reflow, as required by ADR 0012.

Metadata retains explicit saves. Leaving a dirty editor offers Save, Discard, or Cancel.
Resizing never invokes those actions. Existing immediate updates such as notes, ratings,
and shelf membership retain their current behavior. Standard-shelf quick actions and
custom-shelf semantics remain governed by ADR 0010. Playback ownership remains native
under ADR 0013.

Modal sheets trap keyboard focus; the docked pane allows keyboard movement back into the
library. Escape dismisses a surface, and touch access never depends on hover. Browser
verification and native simulator captures are recorded in `docs/verification/responsive/`.
