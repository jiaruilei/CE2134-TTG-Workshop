# Pressure lab B for the CE2134 workshop

This separate presentation service always uses the original rule-based B coach. It needs no study-assignment cookie and can therefore run inside Slide 6's webpage frame. The original study website and its participants are unaffected.

The simulation page, including all teaching text, controls, visuals, and the existing coach heading, is unchanged. The server retains the original pressure calculation and rule-based response functions. The workshop's A/B selector identifies this as B.

## Run and deploy

Requires Node.js 20 or later.

```sh
npm ci
npm run check
npm test
npm start
```

On Render, use a Node web service with:

- Root directory: `demos/pressure-b`
- Build command: `npm ci`
- Start command: `npm start`
- Health check: `/api/health`

Render supplies `PORT`. No OpenAI API key, study secret, study codes, database, or disk is needed. Do not copy the original study's secrets. `COACH_RATE_LIMIT` optionally controls the existing per-IP limit (default: 30 questions per 10 minutes).

The backend has no AI request code or condition-selection route. Cookies and condition fields are ignored. Every successful coaching response has `source: "rule_based"`. The only session data held by this server is the in-memory request count for rate limiting; it does not save or log questions, answers, or student identifiers. Render may retain normal service/access logs. The unchanged frontend retains the original browser-local anonymous session ID behavior.

## Source and preservation

Copied from [jiaruilei/hydrostatic_pressure](https://github.com/jiaruilei/hydrostatic_pressure) at commit [`0b830b1b635a6d767441e1f26b4791d2f882aa78`](https://github.com/jiaruilei/hydrostatic_pressure/tree/0b830b1b635a6d767441e1f26b4791d2f882aa78), directly from that commit, not from the separate draft cookie patch.

- `index.html` is the complete original frontend. Its only external script is the original MathJax CDN dependency; no additional local frontend assets are required.
- `finiteNumber`, `getPressureContext`, `readableNumber`, and `ruleBasedCoachReply` are copied without edits.
- The server removes study assignment, OpenAI calls, and transcript logging, and returns the original B reply directly.
- `provenance.json` records the source commit and SHA-256 digests. Tests verify the frontend and original function sections, normalizing only line endings across operating systems.
- The pinned upstream repository has no `LICENSE` file or package license field. This duplicate was requested by the repository owner; it does not add or infer a new license. Express and its dependencies retain their own licenses in the installed packages.

Tests use a temporary local HTTP server, reject attempted upstream fetches, and verify cookie-free B behavior, resistance to A overrides, unchanged pressure answers, and challenge answer hiding.
