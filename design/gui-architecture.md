# Local chat GUI

## User flow

Run `npm start`. The Node process loads the checked-in OKF bundle and serves a local browser chat at `http://127.0.0.1:4317`. Type in the single-line composer and submit with Enter. The browser receives Markdown answers and verified sources from the existing agent.

## Domain shape

The browser keeps a list of turns and one request state. Each turn is pending, answered with an `AgentRun`, or failed with a message. Only one request runs at a time. The answer request is a trimmed question string. Theme is `light` or `dark`; the browser follows the operating system until the user chooses and saves a preference.

The server owns the `OkfBundle`, calls `answerQuestion`, and returns its `AgentRun`. The browser renders the answer, verified sources, citation warnings, and run metadata. It never receives the Groq key. It keeps transcript data only in memory.

## Module shape

- `agent/src/gui.ts` owns the loopback HTTP server, request parsing, response boundaries, and static asset routes.
- `agent/web/index.html` defines the accessible chat structure.
- `agent/web/theme.js` applies a saved or system theme before the page paints.
- `agent/web/app.js` owns chat state, fetch requests, DOM updates, and theme changes.
- `agent/web/styles.css` owns layout, focus states, and light and dark color tokens.
- `agent/src/cli.ts` makes the GUI the default chat command and retains separate non-interactive knowledge-base commands.

## Design choice

The prototype compared a focused chat layout with a context sidebar. The focused layout keeps attention on the question, answer, and sources. It also adapts to narrow screens without rearranging a second information column. The shipped layout uses a single centered conversation with a compact header, a labeled theme control, source links, expandable run details, and a composer fixed to the bottom of the chat area. The conversation scrolls without a visible scrollbar, and the composer is a single-line input. Marked parses answer Markdown and DOMPurify sanitizes its HTML before rendering.

The browser uses system typography, clear hierarchy, accessible labels, visible keyboard focus, and platform-aware light and dark appearance. These choices take direction from Apple's Human Interface Guidelines without copying macOS-only controls into a browser app.

The local Node server uses built-in HTTP APIs. It binds to loopback, serves a fixed asset list including the Marked and DOMPurify browser modules, caps and validates JSON input, checks the request host and origin, and returns generic errors for provider failures. Credentials remain on the server.

## Verification

HTTP tests cover valid and invalid requests, static routes, host and origin checks, status output, and provider error redaction. Project tests and typecheck cover integration. A live browser check covers question submission, source display, theme switching, and mobile layout.
