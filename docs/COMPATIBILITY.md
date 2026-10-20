# Compatibility and troubleshooting

## Compatibility boundaries

- Target baseline: Home Assistant 2026.10, modern Chromium/Safari/Firefox-class browsers. The automated suite currently runs Chromium with API/frontend fixtures, not a live HA backend.
- Dedicated reference editor: `floor3dx-card`, `floor3dpro-card`, `floor3d-card`, and `floor3d-snapshot-card` are recognized. The actual installed card must implement `getConfigElement`. Name recognition is not proof that every version works.
- Other native/custom cards: runtime delegates rendering to Home Assistant's card helpers. Native editors are reused where exposed. No universal third-party compatibility guarantee.
- Storage dashboards: normal dialog saves and explicit same-dashboard source saves use Home Assistant's existing controller.
- YAML dashboards: runtime reads saved configuration through HA. File changes need the normal reload workflow. The helper cannot save source files through the UI.
- Multiple dashboards: source URL paths are explicit. Access requires the current user's authorized configuration reads. Dashboard visibility is not a security mechanism.
- UIX: selector recognizes the saved `element` of `custom:uix-forge`. Templates, generated cards, layered options, and foundries may require manual YAML editing. This package does not supply the UIX integration.

## Missing custom element

Check that the bundled resource and the underlying custom-card resources are installed and loaded. Remove the old three resource registrations. Reload the browser/app fully. A duplicate-resource warning means an old class already exists in this frontend session; hot replacement is not supported.

## Missing reference or source

Save the source dashboard first. Verify its URL path, unique card ID, and role spelling. Entity roles must be inside a `card_reference_id` source subtree. Do not set `dashboard` to the view path or friendly title. Check whether the signed-in user can read the source dashboard's configuration.

## Entity ID visible instead of a role

That is expected in the resolved card editor. Its working configuration uses real IDs, while accepted changes restore reference tokens. Dashboard-wide raw configuration and saved YAML retain the tokens. To inspect the canonical configuration, use the dashboard raw configuration editor or the YAML file.

## A device selection cannot be saved

Create a unique source role for the new entity, save the source dashboard, and reopen the editor. For a replacement device serving the same purpose, update the existing authoritative source assignment and retain its role. If several roles share one entity, preserve the existing role or use the exact role token to disambiguate.

Generic component editing deliberately protects existing bindings. Use the source entry for assignment changes; the dedicated model editor and resolved YAML bridge support reverse mapping to known roles.

## Editor stops working after a Home Assistant update

Try the resource query `?component_editor=false` to disable the broad adapter, or `?editors=false` to keep only runtime rendering. Register one resource URL, then reload. Include the Home Assistant version, browser/app, package version, minimal configuration, and console error in an issue.

The YAML bridge depends on the HA editor's Lit template and `_handleYAMLChanged`. It reports when the expected template cannot be located rather than showing unresolved working content as though it were resolved. Other internal API changes can still require a package update.

## Unexpected layout or titles

Whole-card references retain headings by default. Use `strip_heading: true` when appropriate. Override tab labels with `labels`. Destination placement belongs on the wrapper. Source `view_layout`, visibility, and third-party styling can still affect layout; inspect those saved properties.

## A changed source does not appear

Save the source dashboard. Runtime refresh depends on `lovelace_updated` or reconnect events. If events are unavailable, recreate/reopen the reference or reload the frontend. Reopen editors after changing source assignments elsewhere. YAML-file changes may need the normal HA reload first.

## Security and privacy

The package does not provide permissions, guest isolation, secret storage, or entity-level authorization. Frontend code and dashboard configuration are available to the authorized browser. Do not put credentials in dashboard metadata. Reference errors may include source identifiers/entity IDs in the local browser console. No telemetry or external script fetching is implemented by this package.
