# Setup

The wizard and CLI need a MoltNet service and a worker that handles their
modeling tasks. Connect to an existing service or follow the official
[MoltNet self-host deployment guide](https://docs.themolt.net/deploy/docker-compose).
Run the commands below from this repository's root after configuring the
MoltNet CLI and agent daemon for your service. Set `TEAM` to the MoltNet team
ID and `DIARY` to the diary ID that will own the design tasks. The
[agent operations guide](https://docs.themolt.net/operate/running-agents)
covers daemon configuration and worker routing.

## Runtime profiles

`runtime/profiles/legreffier-pddl-designer-v1.json` is input-only. It
has no workspace and no network, and it binds the empty tool policy
`runtime/policies/legreffier-pddl-designer-input-only-v1.json`. Its
`pddl-modeling` skill carries the modeling rules shared by all stages. Each task
brief carries that stage's instructions and the earlier results.

The definitions are not applied automatically. Create them with the released
CLI:

```bash
moltnet policy create --from-file runtime/policies/legreffier-pddl-designer-input-only-v1.json --team-id "$TEAM"
moltnet profile create --from-file runtime/profiles/legreffier-pddl-designer-v1.json --team-id "$TEAM"
moltnet profile set-policies legreffier-pddl-designer-v1 --policy legreffier-pddl-designer-input-only-v1 --team-id "$TEAM"
moltnet profile allowed-tools legreffier-pddl-designer-v1 --team-id "$TEAM"
```

### Choose a default and override only where useful

A runtime profile selects a model and its generation settings, shared context,
tool policy, and sandbox. It is not a workflow step: each task carries its own
step instructions, output contract, and earlier results. One generation profile
can therefore serve all five modeling steps.

In the wizard, open **MoltNet connection**, enter a **Default generation profile
name or ID**, and expand **Choose profiles by step** for optional overrides.
Names and IDs must belong to the selected team. Empty overrides inherit the
default. The app resolves all selected profiles before creating modeling tasks.

| Wizard step            | CLI override           | What to optimize for                                    |
| ---------------------- | ---------------------- | ------------------------------------------------------- |
| Types                  | `--types-profile`      | Reliable extraction of entity kinds                     |
| Facts                  | `--predicates-profile` | Relationships and typed arguments                       |
| Actions                | `--actions-profile`    | Preconditions, add/delete effects, resource constraints |
| Refinement             | `--refine-profile`     | Reasoning across actions and repairing inconsistencies  |
| Situation              | `--problem-profile`    | Concrete objects, initial facts, and goals              |
| Plan and static checks | None                   | Deterministic local code; no model call                 |

Start with the supplied profile as a baseline. If actions or refinement need
more reliable reasoning, create a second profile from the supplied definition:
change its `name` and `models.generation` to a model/provider supported by your
runtime, then create it and bind the same input-only tool policy. Keep the
shared modeling context and output-submission instructions. No workspace,
network access, or additional tools are needed for these stages. The bundled
model is an experimental baseline, not a requirement or a quality guarantee.
Compare results on your own process descriptions before changing models.

For example, after creating a second profile named `pddl-reasoning`:

```bash
pnpm --silent cli \
  --description examples/issue-workflow/description.md \
  --problem examples/issue-workflow/situation.md \
  --team "$TEAM" --diary "$DIARY" \
  --profile legreffier-pddl-designer-v1 \
  --actions-profile pddl-reasoning --refine-profile pddl-reasoning \
  --out run.json
```

The library equivalent is `DesignInput.profileId` plus optional
`stageProfiles: { actions: reasoningProfileId, refine: reasoningProfileId }`.
Library callers pass resolved profile IDs; the wizard and CLI also accept names.
Corrections and retries use the profile selected for their modeling step.

### Start matching workers

Creating a profile does not start a worker. Your daemon must serve `freeform`
tasks for every selected generation profile in the same team. Run a worker for
each profile using your configured daemon identity (separate terminals/processes
when using `drain`):

```bash
moltnet-agent drain --profile legreffier-pddl-designer-v1
# In another terminal, when this profile is used by an override:
moltnet-agent drain --profile pddl-reasoning
```

To prefill the wizard's default connection:

```bash
pnpm dev --team "$TEAM" --diary "$DIARY" --profile legreffier-pddl-designer-v1
```

The local server also reads `MOLTNET_TEAM_ID`, `MOLTNET_DIARY_ID`, and
`MOLTNET_PROFILE_ID`; explicit flags take precedence. Profile references are
configuration, not credentials. Authentication stays on the server. Saved proofs
can be inspected and manually edited offline; asking for a generated correction
requires the selected workers again.

If a profile is **not found**, check its name/ID and team. If a step is **waiting
for a worker**, check that the daemon serves that exact profile and task type,
and that its team/correlation filters admit the run. If execution fails, check
provider credentials and model availability in the daemon environment. Granting
extra filesystem or network permissions is not a remedy for a routing problem.

Optional semantic review uses `--review --classify-profile` with a profile
configured for `models.classification` and a worker serving `classify` tasks.
This is separate from generation overrides and is currently CLI-only. See
[Plan review](../README.md#plan-review-optional); static validation remains authoritative.
