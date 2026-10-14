# PDDL designer workflow

The five extraction/refinement nodes are contracted MoltNet `freeform` tasks.
Rendering, validation, reachability, and planning run locally. The two yellow
nodes are MoltNet `classify` tasks, served by a classification profile.

```mermaid
flowchart TD
    Input["Process description + situation"]

    Input --> Types["freeform task: types"]
    Types --> CT{"Local: validate types<br/>Optional confirmStage"}
    CT --> Predicates["freeform task: predicates"]
    Predicates --> CP{"Local: validate predicates<br/>Optional confirmStage"}
    CP --> Actions["freeform task: draft actions"]
    Actions --> CA{"Local: validate actions<br/>Optional confirmStage"}

    CA --> Enabled{"Early warning review enabled<br/>and candidate warnings exist?"}
    Enabled -->|Yes| Early["classify tasks: early warning review<br/>Does the original description establish<br/>that each warning is a defect?"]
    Enabled -->|No| Refine
    Early --> Feedback["Local: record all judgments<br/>Turn confirmed concerns into feedback"]
    Feedback --> Refine["freeform task: refine actions"]

    Refine --> CR{"Local: validate refined actions<br/>Optional confirmStage"}
    CR --> Problem["freeform task: problem"]
    Problem --> CheckProblem{"Local: validate problem + reachability<br/>Optional confirmStage"}
    CheckProblem --> Render["Local: render typed model as PDDL"]
    Render --> Planner["Local: ground actions + search for a plan"]

    Planner --> Review{"Plan found and<br/>final review enabled?"}
    Review -->|No| Result["DesignRun: model, plan,<br/>findings and task evidence"]
    Review -->|Yes| Analysis["Local: analyze shortcuts<br/>and shared work"]
    Analysis -->|Skippable actions| Final["classify tasks: final plan review<br/>Does the description require<br/>each skippable action?"]
    Analysis -->|Shared-work findings| Repair
    Analysis -->|No skippable actions| Repair
    Final --> Repair{"Local: findings<br/>and repair budget?"}
    Repair -->|No findings or budget exhausted| Result
    Repair -->|Required-step finding| Recheck["Local: use current refined actions<br/>Re-enter early review if enabled"]
    Recheck --> Enabled
    Repair -->|Shared-work finding| Predicates

    Early -.->|Question fails| Failure["DesignRun: failed<br/>Preserve partial classification evidence"]

    classDef classify fill:#fff1b8,stroke:#a66b00,stroke-width:2px,color:#332100
    class Early,Final classify
```

Early review runs after draft acceptance and before refinement, so it sees
reviewer edits rather than a stale task result. It judges ownership/linking and
permanent-fact warnings. Confirmed concerns guide refinement; dismissed and
uncertain judgments stay in the audit record. This experiment does not change
final acceptance rules or discover entirely missing requirements.

Final review asks a different question: can a planner skip a step that the
process requires? Its local analysis also detects shared work without a
classifier. Findings can trigger bounded repairs to refinement or to predicates
and actions. The problem is reused only while it remains valid for the new
domain. PDDL is rendered whenever the corresponding typed model changes, so
the problem task also receives the rendered domain.

To keep the diagram readable, generation retry edges are omitted. Every
generation result passes schema and static checks. Automatic corrections are
bounded by `maxCorrections`; `confirmStage`, when supplied, can accept a valid
result, edit and recheck it, request a feedback task, or abort. Classification
cannot waive these checks. Early review has no separate semantic retry loop.

## Wizard flow (built on PR #3)

```mermaid
flowchart TD
    Setup["Expert writes process + situation"] --> OptIn{"Enable optional warning assessment?"}
    OptIn -->|Yes| Profile["Choose classification profile<br/>Separate worker serves classify tasks"]
    OptIn -->|No| Generate
    Profile --> Generate["Generate types, facts, draft actions<br/>Expert reviews each stage"]
    Generate --> Gate["Expert edits and passes Actions"]
    Gate --> Candidates{"Assessment enabled<br/>and candidate warnings exist?"}
    Candidates -->|No| Refine["Generate Refinement"]
    Candidates -->|Yes| Classify["Paid classify tasks<br/>Original description + accepted model + warning"]
    Classify --> Evidence["Display warning, exact question, criteria,<br/>probability, task ID and reported usage"]
    Evidence --> Route{"Probability of defect"}
    Route -->|At least 90%| Feedback["Add targeted repair feedback"]
    Route -->|10% or less| Keep["Dismiss warning; no targeted repair"]
    Route -->|Between 10% and 90%| Uncertain["Record uncertainty; no targeted repair"]
    Feedback --> Refine
    Keep --> Refine
    Uncertain --> Refine
    Refine --> Expert["Expert reviews Refinement<br/>Accept, edit, return with note, or stop"]
    Expert --> Plan["Review situation + local plan walkthrough"]
    Plan --> Save["Save proof with assessment evidence"]
    Save --> Edit["Offline model edits invalidate old assessments<br/>No model calls"]
```

Classification is a run setting, not an extra approval stamp. It runs only after
an accepted action model, and it cannot waive a blocking static error. This UI
exposes early warning assessment; final plan review remains a separate CLI/library
option. Failure retains partial answers and identifies the warning-review stage.

See [Decision models](decision-models.md) for the exact payload construction and
possible next designs. The narrower questions described there are proposals,
not the questions used by the completed benchmark.
