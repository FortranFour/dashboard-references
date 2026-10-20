First community beta combining dashboard card reuse, shared named entity assignments, and the two native editing helpers in one HACS dashboard plugin.

- Existing reference card types and source metadata retained.
- One bundled resource; optional editor-disable URL flags.
- Explicit source-dashboard lookup and save/reconnect refresh.
- Built-in keyboard-accessible tabs and native vertical/horizontal stacks.
- Generic behavior: no household IDs, mail-model patch, or special utilities composition.
- README leads with the ordinary dashboard as the authoritative source and recovery of existing native editors inside styled/wrapped configurations.
- Configuration reference, migration notes, related-package comparison, complete examples, MIT license, browser regression checks, and HACS/release workflows.

This is a beta. Automated browser tests use a simulated Home Assistant frontend/API; live HA, actual 3D scenes, mobile apps, and all third-party card versions have not been certified. The component/YAML adapter uses HA frontend internals and can be disabled independently.

Install through HACS as a custom Dashboard repository. Default HACS catalog inclusion is a separate review.
