# Architecture

Project Manager is a self-hosted, mobile-first progressive web app. It uses
Flask, browser-native JavaScript, a service worker, and a single JSON data
file. There is deliberately no build step or frontend framework.

## File layout

```text
app/
  main.py                    Flask application, HTTP routes, persistence policy
  landing_page.html          Project-list screen and its screen controller
  project_view.html          Project-detail screen and its screen controller
  offline-service-worker.js  Shell/API/file caching strategy
  static/
    app-shell.css            Shared visual system and mobile app chrome
    landing-page.css         Landing-only layout and composition
    project-view.css         Detail-only layout and composition
    app-shell.js             Shared interaction shell (scroll, sheets, swipe)
    app-core.js              Shared UI primitives: HTML, time, and theme helpers
    api-client.js            Shared HTTP request/JSON boundary
    icons.js                 Persistent standard and custom icon collection
    task-tree.js             Pure task traversal, validation-friendly updates, moves
    materials.js             Project-file metadata, sharing, and offline-cache helpers
    offline-data.js          Offline write-ahead queue and reconnect sync
    iconify-catalog.js       Lazy Iconify search integration
  data/                      Host-owned JSON and uploaded files; never commit
tests/
  test_app.py                API and browser-delivery regression tests
```

## Ownership and dependencies

The dependency direction is intentionally one-way:

```text
screen controller  -> app-core + app-shell + offline-data -> REST API -> main.py -> JSON storage
service worker     -> static assets and GET API responses
```

- `app-core.js` must remain DOM-light and screen-independent. Put reusable
  formatting, escaping, theme, and small presentation helpers here.
- `api-client.js` is the only place to add cross-cutting request behavior
  (JSON encoding, auth, retries, or standard errors). Screen controllers may
  retain a raw response only when they genuinely need response metadata.
- `app-shell.js` owns cross-screen gestures and browser integration. It may
  depend on markup conventions (`.app-scroll`, modal classes), but must not
  own project or task data.
- `task-tree.js` owns task-tree algorithms only. It must not access the DOM,
  browser storage, or the active project; pass all state in and receive a new
  tree back.
- `materials.js` owns file/link normalization and browser file-cache mechanics.
  It returns outcomes (for example `saved` or `offline`) so page controllers
  can choose the appropriate toast or dialog without duplicating mechanics.
- Each HTML screen owns only its page-specific state, rendering, and event
  wiring. Extract a feature into `static/features/` when it is shared by both
  screens or becomes independently testable (for example: task-tree rules).
- `main.py` is the boundary for validation, persistence, and HTTP status
  codes. Frontend constraints (such as task nesting) must also be enforced
  here; client checks are usability aids, not data integrity.
- The service worker never invents data. It caches successful GET responses;
  mutations are queued by `offline-data.js` and reconciled by the API.

## Data and offline policy

`projects.json` is written atomically while an in-process lock is held. A
project contains its tasks, links, uploaded-file metadata, and linked-file
metadata. Deleted records are retained in a bounded recently-deleted list and
can be restored; UI copy must say “move to recently deleted”, not “permanent”.

Offline mutations are complete project snapshots. On reconnect, the server
uses the newest `updated_at` timestamp. This is suitable for a personal,
single-writer app. Before adding real multi-user or concurrent multi-device
editing, replace it with revisions plus a visible conflict response.

## Adding a feature

1. Start with the domain/data shape and server validation.
2. Add an API test for the expected success and failure cases.
3. Add the smallest screen controller/rendering change.
4. Reuse `PM.html`, `PM.time`, `PM.theme`, and app-shell behavior rather than
   duplicating helpers.
5. Update the service-worker asset list/cache version only if a new runtime
   asset must work on first offline launch.

## Design constraints

- A shared visual concept has one semantic class and one declaration in
  `app-shell.css`. Do not copy a card, sheet, input, picker, toolbar, button,
  or empty-state rule into a page stylesheet. Page stylesheets may arrange
  shared components, but must not redefine their visual treatment.
- Keep page-specific CSS limited to layout/composition selectors rooted at
  `.landing-page` or `.project-page`. This makes the common UI genuinely
  reusable and prevents visual drift between the two screens.
- Theme tokens are owned exclusively by `app-shell.css`; page styles must use
  the tokens and never redeclare light/dark palettes.
- Keep task nesting to three visible levels; use projects or links for larger
  structures.
- Keep the project page centred on next actions, materials, and a compact
  completed archive.
- Preserve native-feeling touch targets, reduced-motion behavior, keyboard
  access, and offline feedback when changing UI.
