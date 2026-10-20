# Configuration details

## Source scope and identity

Each `card_reference_id` identifies one card in one source dashboard. Each entity role identifies one authoritative field under any card marked with a `card_reference_id`. Keep both sets unique within a dashboard. Entity IDs themselves need not be unique: two intentional roles can point to the same entity, but reverse mapping in editors then needs the existing role to disambiguate.

Source discovery follows `views`, `sections`, `cards`, `card`, `tabs`, `entities`, and `elements`. Action payloads are not treated as whole-card sources. Entity resolution reads values from the full source subtree. Sources are saved configuration, not rendered card DOM.

## Ordinary entity property

```yaml
type: entities
card_reference_id: room_controls
entities:
  - entity: light.study
    entity_reference_id: study_light
```

## An entity in another field

`entity_reference_fields` maps roles to explicit paths, relative to the node carrying that mapping. Path elements may be field-name strings or array indices.

```yaml
type: picture-entity
card_reference_id: entry_camera
camera_image: camera.entry
entity: binary_sensor.entry_motion
entity_reference_fields:
  entry_camera:
    path: [camera_image]
  entry_motion:
    path: [entity]
```

## An entity embedded in a template

Use an explicit domain selector only when the selected string contains exactly one distinct entity ID in that domain. The source template is inspected as text; it is not evaluated by this package.

```yaml
type: markdown
card_reference_id: temperature_description
content: "Temperature: {{ states('sensor.study_temperature') }}"
entity_reference_fields:
  study_temperature:
    path: [content]
    domain: sensor
```

If two different `sensor.*` IDs appear in the selected string, resolution fails instead of guessing.

## Extra authoritative entities

Use a saved catalog card for assignments with no natural control on the main dashboard. A visible catalog is simplest to inspect and debug; a source-only view is also possible. View visibility is presentation, not authorization.

```yaml
type: entities
title: Shared entity catalog
card_reference_id: shared_entity_catalog
entities: []
entity_reference_extra:
  entry_camera: camera.entry
  study_temperature: sensor.study_temperature
  popup_trigger: input_button.room_popup
```

There is no household-specific exception for helper entities: if a helper inside a referenced layout should participate in editor reverse mapping, give it an explicit role too. Literal entities can be used outside referenced layouts.

## Entity token boundaries

Only tokens matching `[[entity:role_name]]` are resolved. Invalid or incomplete tokens report an error. Mapping keys are not substituted. A source must resolve to a syntactically valid `domain.object_id`, but that does not guarantee the entity currently exists or is available. Native card behavior handles entity availability.

No executable template language is added. If the wrapped card normally evaluates Jinja or JavaScript, it still owns that evaluation after reference substitution.

## Placement

Place `grid_options`, `layout_options`, `view_layout`, or visibility rules on the destination wrapper when they describe the destination. Whole-card cloning removes only outer `grid_options` and `layout_options`, plus reference metadata throughout the cloned content. Other source properties remain, including any `view_layout` or visibility settings; review these if moving between layout systems.

## Popups

Put a reference card where your popup implementation expects its card content. This package renders content; your existing popup provider handles opening, closing, titles, and modal behavior. You can request `strip_heading: true` when the provider already supplies the title.

There is no dependency on Browser Mod for ordinary references. Browser Mod-specific actions should follow Browser Mod's current documentation; its API is not bundled here.

## Reusing 3D configurations

Give the original model card a `card_reference_id`, then render references in separate views. Alternatively, put `custom:dashboard-entity-reference` around a model with named assignments. Keep model URLs, object IDs, and other renderer options appropriate to your own card version.

This shares YAML configuration, not the renderer's scene instance. Two simultaneously displayed references can create two WebGL scenes and incur the corresponding load. The source render and a reference render are independent.
