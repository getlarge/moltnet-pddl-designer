(define (domain housing-historical)
  (:requirements :strips :typing)
  (:types
    project-requirements planning-constraints building-program floor-plan bim-element ifc-model visualisation-assets render-view human-reviewer system-agent - object
  )
  (:predicates
    (free ?x - project-requirements)
    (in-use ?x - planning-constraints)
    (used-up ?x - building-program)
  )
  (:action extract-project-requirements
    :parameters (?sys - system-agent ?pr - project-requirements)
    :precondition (free ?pr)
    :effect (and (free ?pr) (not (free ?pr)))
  )
  (:action extract-planning-constraints
    :parameters (?sys - system-agent ?pc - planning-constraints)
    :precondition (and)
    :effect (in-use ?pc)
  )
  (:action derive-building-program
    :parameters (?sys - system-agent ?bp - building-program)
    :precondition (and)
    :effect (used-up ?bp)
  )
  (:action solve-floor-plan
    :parameters (?sys - system-agent ?fp - floor-plan)
    :precondition (and)
    :effect (and)
  )
  (:action validate-plan
    :parameters (?sys - system-agent ?fp - floor-plan)
    :precondition (and)
    :effect (and)
  )
  (:action derive-building-elements
    :parameters (?sys - system-agent ?be - bim-element)
    :precondition (and)
    :effect (and)
  )
  (:action export-or-update-ifc
    :parameters (?sys - system-agent ?ifc - ifc-model)
    :precondition (and)
    :effect (and)
  )
  (:action validate-ifc
    :parameters (?sys - system-agent ?ifc - ifc-model)
    :precondition (and)
    :effect (and)
  )
  (:action stage-visualisation
    :parameters (?sys - system-agent ?va - visualisation-assets)
    :precondition (and)
    :effect (and)
  )
  (:action render
    :parameters (?sys - system-agent ?rv - render-view)
    :precondition (and)
    :effect (and)
  )
  (:action human-review
    :parameters (?hr - human-reviewer)
    :precondition (and)
    :effect (and)
  )
)
