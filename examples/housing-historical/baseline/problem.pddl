(define (problem house-1)
  (:domain housing-historical)
  (:objects
    sys-1 - system-agent
    pr-1 - project-requirements
    pc-1 - planning-constraints
    bp-1 - building-program
    fp-1 - floor-plan
    be-1 - bim-element
    ifc-1 - ifc-model
    va-1 - visualisation-assets
    rv-1 - render-view
    hr-1 - human-reviewer
  )
  (:init
    (free pr-1)
  )
  (:goal (used-up bp-1))
)
