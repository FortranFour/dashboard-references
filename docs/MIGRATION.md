# Migrating from the three local resources

This package combines the supplied Dashboard Card Reference 1.2.0, Dashboard Reference Editor 1.0.0, and Dashboard Component Editor 1.1.0. Public package versions are separate from those historical helper versions.

1. Export or duplicate your dashboard before changing resources.
2. Install Dashboard References in HACS.
3. Remove the resource registrations for `/local/dashboard-card-reference.js`, `/local/dashboard-reference-editor.js`, and `/local/dashboard-component-editor.js`, including version-query variants. Keep the old files on disk temporarily for rollback; unregistered files are not loaded.
4. Register only `/hacsfiles/dashboard-references/dashboard-references.js` as a module.
5. Reload every browser and mobile frontend. Custom elements cannot be replaced in an already-running page.
6. Open a reference, edit a nested component, and save a small reversible change on your duplicate dashboard before switching regular use.

Card types, `card_reference_id`, `entity_reference_id`, `entity_reference_fields`, `entity_reference_extra`, `dashboard`, `card_id`, `card_ids`, `card`, and `expected_domains` retain their meanings. There is no automatic dashboard migration or rewrite.

## Intentional community-package differences

| Earlier household helper | Community package |
| --- | --- |
| Headings removed automatically | Headings retained unless `strip_heading: true`. Add that option to popup references where appropriate. |
| Static titles automatically title-cased | Saved text retained exactly. |
| Multiple sources use a particular external tab card | Built-in accessible tabs; `layout` also supports vertical/horizontal stacks. |
| `utilities` + `energy_date` IDs trigger special composition | No identifier-specific composition. Store the desired graph/date-control combination as one source card, or use `layout: vertical`. |
| Mail-counter texture patch applied to a particular 3D object | Patch omitted. Keep any needed mail-label fix in the renderer or a separately maintained local resource. |
| Some floor3d helper entities bypass editor reference checks | Register helper entities explicitly in the source catalog. |
| Active dashboard could supply a matching ID despite another requested dashboard | Explicit source dashboard is read through the authenticated WebSocket API. |
| Mounted references could retain old source configurations | Save/reconnect events invalidate caches and refresh consumers. |

An unrelated helper such as `llmvision-popup-fix.js` is not included and should not be removed as part of this migration.

## Roll back

Restore the previous three resource registrations, unregister the bundled resource, restore any configuration changes made during the trial if needed, and reload the frontend. Merely copying an old file over a new one cannot replace already registered custom elements without a reload.
