# Verification record

Local verification on October 20, 2026:

- JavaScript syntax checks passed for all three sources and the generated module.
- Package metadata and removal of household-specific identifiers checked.
- **31 automated browser checks passed**, using Chromium 153 with Playwright 1.62.1 and simulated Home Assistant card/API/editor objects.
- Example YAML and workflow YAML parsed without YAML 1.1 implicit y/yes/on boolean coercion.

The suite covers card registration, non-mutating source cloning, heading behavior, explicit cross-dashboard lookup, concurrent request deduplication, entity substitution, domain guards, duplicate source detection, nested-reference rejection, save/reconnect/reattachment refresh, unchanged-child retention, built-in tabs/stacks, native editor ID-to-role round trips, Forge component discovery, metadata/reference/y/boolean preservation, resolved YAML editing, known/missing entity selections, invalid YAML, explicit source saving, source conflict protection, YAML-mode save restrictions, cross-dashboard editing guidance, disable flags, and duplicate-resource guards.

Source-save tests exercise the component editor's real save method with a fixture Lovelace controller. Native reference-editor tests exercise the package's real bridge with a fixture native card editor. They do not run an actual floor3d renderer, real native third-party editor implementation, WebGL model, or Home Assistant backend.

The default Playwright Chromium download was unavailable locally. A separately packaged Chromium executable was used through the optional `REFERENCE_TEST_CHROMIUM` environment variable. CI installs Playwright's standard Chromium and runs the same test suite. That CI result and HACS validation must be checked after publication; local browser success is not a claim that remote Actions have passed.

## Reproduce

```sh
npm ci
npx playwright install chromium
npm run build
npm run check
npm test
```

To use an already installed compatible Chromium binary:

```sh
REFERENCE_TEST_CHROMIUM=/absolute/path/to/chromium npm test
```

The runtime bundle has no dependency on either Playwright or a browser binary package. Those are development/test tools only.

## Still to verify live

- Target Home Assistant 2026.10 and later frontend changes.
- Safari/iOS companion app behavior, tab sizing and refresh.
- Underlying floor3d/snapshot editor and renderer versions.
- UIX editor-hook coexistence beyond saved `element` discovery.
- Home Assistant user permission combinations and YAML reload behavior.
- HACS download/resource registration and remote Actions.
