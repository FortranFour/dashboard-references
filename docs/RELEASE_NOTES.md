Dashboard References 0.1.0-beta.3

- Preserve shared popup content when a referenced card opens another reference through a Browser Mod tap, hold, or double-tap action.
- Keep immediately rendered nested whole-card references blocked to prevent rendering cycles.
- Add browser checks for the deferred popup exception and its boundaries.

Both reference cards and both optional editor helpers remain in the single resource. Existing reference syntax is unchanged.

Install through HACS as a custom Dashboard repository: FortranFour/dashboard-references.

Automated browser checks simulate Home Assistant's frontend/API; live HA, actual 3D scenes, and mobile apps have not been certified.
