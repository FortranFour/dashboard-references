# Contributing

Please include a minimal source dashboard and consuming card, exact HA/browser/card versions, and whether an issue persists with `?editors=false`. Remove private entities, images, URLs, and credentials before sharing.

Run `npm ci`, `npx playwright install chromium`, `npm run build`, `npm run check`, and `npm test`. Commit changes to both `src/` and the generated `dist/dashboard-references.js`. Do not hand-edit the generated bundle.

Changes to reference token semantics, editor reverse mapping, cache invalidation, or source saving should include focused regression coverage. The initial browser suite uses HA fixtures; report live integration findings separately. Do not claim support for an untested card version solely because it exposes an editor.

Maintainers publish version tags matching `package.json` after validation. The current workflow makes prereleases. HACS default listing requires a separate submission once the project meets the current catalog requirements.
