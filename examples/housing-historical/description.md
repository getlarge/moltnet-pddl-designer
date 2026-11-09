# Proposed Workflow

Goal: `client brief + site + planning constraints -> floor-plan variants -> IFC/BIM -> validation -> attractive renders -> human review -> Archicad`.

## MoltNet tasks

- `extract-project-requirements`: derive storeys, rooms, target areas, garage, openings, orientation/style preferences and client priorities from source documents.
- `extract-planning-constraints`: derive setbacks, height, site coverage, roof, access, parking and other rules with source provenance. Require human confirmation initially.
- `derive-building-program`: create the space programme, target/minimum areas, adjacency graph, circulation and orientation preferences.
- `solve-floor-plan`: use optimisation/constraint solving rather than LLM-generated arbitrary coordinates.
- `validate-plan`: check areas, widths, overlaps, topology, circulation, site boundary, setbacks, footprint, orientation and openings.
- `derive-building-elements`: create walls, slabs, roof, openings, doors/windows and other BIM elements.
- `export-or-update-ifc`: prefer mutating canonical IFC state where practical rather than maintaining a parallel full building model.
- `validate-ifc`: re-open the IFC and run semantic, IDS and geometric validation.
- `stage-visualisation`: add non-authoritative presentation assets such as materials, furniture, kitchen, vegetation and lighting.
- `render`: generate street, garden, interior, axonometric and plan views.
- `human-review`: let the designer/commercial user select or reject variants and iterate.

## POC phases

### POC 0 — Reconstruction
Reconstruct one supplied real project into IFC and verify that it can be inspected, rendered and eventually opened by the drafting team.

### POC 1 — Parametric modification
Change an extracted model (for example a larger living room, wider garage, added room) and solve a new valid configuration.

### POC 2 — Generation
Generate multiple layouts from brief + site + constraints, validate/rank them, then emit IFC + renders.

## Initial benchmark caveat

The handwritten starting brief and supplied plan are different design revisions. The plan reflects later client modifications, so differences between them must not automatically be scored as generation errors.
