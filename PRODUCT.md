# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React, run locally by the person using it. Client-rendered, no SSR:
the user asked whether to use SSR, and Claude recommended against it (a
single-user local tool gains nothing from server rendering). Work that needs
credentials or long-running tasks (running `runPddlDesign`, streaming its
progress events) lives in a small endpoint in the same local server, not in
the browser. Confirm the SSR choice if it matters later.

## Users

Primary: domain experts who own a process (for example how a team reviews
pull requests, or how a diagnosis is carried out) and can describe it in
plain language, but do not know PDDL or planning. Their job is to turn their
description into a model that a planner accepts, and to correct it until it
says what they mean.

Secondary: developers who know MoltNet and PDDL, exploring and debugging
domain generation. Technical detail (typed results, PDDL, task ids) must be
available to them without being in the expert's way.

For now, assume MoltNet is installed and configured on the machine (agent
identity, a running agent daemon); login and setup are out of scope.

## Product Purpose

Turn an expert's process description and a concrete situation into a typed
planning domain and problem, step by step, with deterministic checks after
every step and a planner at the end. Success: the expert ends with a domain
whose plan for their situation matches how the process really runs, and can
see why when it does not.

## Positioning

Unlike a one-shot "generate PDDL" prompt or the reference research tool
(a step-by-step form where every step is an LLM call and nothing is
checked), each stage here is a contracted MoltNet task whose typed result is
checked by code, corrected automatically when it fails, and then shown to
the expert to accept, edit, send feedback on, or stop. The planner verifies
the final model against the situation.

## Operating Context

- Runs on the user's machine against the MoltNet API; stage tasks are served
  by a local `moltnet-agent` daemon using a configured runtime profile.
- Stages, in order: types, predicates, actions, refine, problem, then the
  plan check. A stage may run several attempts (automatic corrections,
  reviewer feedback, reviewer edits).
- The workflow emits progress events (task created, claimed, stage result
  with check findings, accepted, plan checked, review, finished) and pauses
  at a per-stage gate when the UI asks it to.
- Runs produce a `DesignRun` record (JSON) that can be saved and reopened.

## Capabilities and Constraints

- Supported model fragment: STRIPS with typing and negative preconditions;
  no quantifiers, conditional effects or numeric fluents.
- Gate decisions: accept (refused while checks report errors), edit (checked
  like a model result), feedback (new correction task), abort.
- Check findings have a severity (error or warning), a path and a message;
  errors block acceptance.
- Generating a stage needs the MoltNet API and a running daemon; inspecting
  and editing does not.
- Undecided: whether the app also compiles the domain into an agent workflow
  (planned next in the library), and whether runs are listed from a folder.

## Brand Commitments

Its own identity as an experimental planning tool. It does not use the
MoltNet design system or MoltNet branding.

## Evidence on Hand

- Example inputs in `examples/` (blocks-world, issue-workflow,
  issue-workflow-explicit, docs-review, docs-review-guided), each a
  description and a situation.
- Real `DesignRun` records exist locally from earlier evaluation runs; they
  are not part of this repository and must not be shown as product content.
- No users, testimonials or benchmark claims exist; do not invent any.

## Product Principles

1. The expert's words are the source of truth: every model element should
   be traceable to the sentence it came from.
2. Show what the checks found in the expert's terms first; PDDL and JSON are
   one step away, never in front.
3. Progress is honest: show what is running, waiting, or failed, as it
   happens.
4. Never let an invalid result look accepted.
