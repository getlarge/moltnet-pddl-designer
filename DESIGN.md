---
name: Galley Proof
description: A process description, checked in its own margin.
colors:
  paper: '#fff'
  ink: '#1a1a1a'
  muted: '#626262'
  rule: '#d6d4d1'
  red: '#c4161c'
  red-wash: '#fff2f1'
  wash: '#f5f5f2'
  selected: '#eaf2f7'
  focus: '#225b78'
  focus-hover: '#17445c'
  success: '#28603b'
  success-wash: '#edf5ee'
  warning: '#805313'
  warning-wash: '#fff6e7'
  field-border: '#aaa9a6'
  syntax-key: '#075985'
  syntax-keyword: '#832d63'
  syntax-number: '#8a400e'
  syntax-punctuation: '#525252'
typography:
  display:
    fontFamily: 'Literata, Georgia, serif'
    fontSize: 'clamp(34px, 3.8vw, 52px)'
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: '-0.03em'
  headline:
    fontFamily: 'Literata, Georgia, serif'
    fontSize: '28px'
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: '-0.025em'
  title:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '19px'
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.55
  source:
    fontFamily: 'Literata, Georgia, serif'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.85
  label:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 600
    lineHeight: 1.55
  code:
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: '2px'
  sheet: '0px'
spacing:
  compact: '8px'
  small: '12px'
  medium: '16px'
  group: '24px'
  page: '40px'
components:
  button-primary:
    backgroundColor: '{colors.focus}'
    textColor: '{colors.paper}'
    rounded: '{rounded.control}'
    padding: '8px 14px'
  button-primary-hover:
    backgroundColor: '{colors.focus-hover}'
  button-secondary:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '8px 14px'
  button-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    padding: '4px 6px'
  input:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '10px 12px'
  navigation-current:
    backgroundColor: '{colors.selected}'
    textColor: '{colors.focus}'
    padding: '16px 8px'
  stamp-passed:
    backgroundColor: '{colors.success-wash}'
    textColor: '{colors.success}'
    padding: '5px 7px'
  finding-warning:
    backgroundColor: '{colors.warning-wash}'
    textColor: '{colors.warning}'
    padding: '12px'
---

# Design System: Galley Proof

## Overview

**Creative North Star: "Galley Proof"**

A working proof for a process expert in ordinary daylight. The expert's sentences remain the source of truth; numbered lines and keyed model annotations make their relationship inspectable. The interface has its own identity, separate from MoltNet branding.

White stock, dark ink, book text and fine rules create a quiet editing desk. Color directs attention to the current work or communicates a labeled outcome; it does not decorate individual workflow stages. Construction remains available without dominating the plain-language review.

**Key Characteristics:**

- Flat sheets and fine rules, without decorative imagery.
- Readable source prose beside compact controls and annotations.
- Linked selection, explicit findings, and recorded gate status.
- Progressive disclosure for technical detail.

## Colors

A restrained ink-on-stock palette gains cool blue focus and small, semantic green,
amber and red accents. The frontmatter records the actual stylesheet values.

### Primary

- **Focus blue** (`focus`, `focus-hover`): the primary action, keyboard outline,
  current workflow stage and current plan step. `selected` is its pale surface
  for the linked sentence and model annotation.

### Secondary

- **Passed green** (`success`, `success-wash`): passed stamps, met goals and facts
  made true. A visited timeline step carries a green outline without implying
  that the whole run has passed.
- **Review amber** (`warning`, `warning-wash`): author questions, missing source
  references and the explicitly labeled facts made false by an action. Removing
  a fact is a normal transition, not automatically an error.
- **Correction red** (`red`, `red-wash`): blocking findings, error banners and
  destructive-action text.
- **Syntax accents**: keys and variables use `syntax-key`; strings share the
  green value; keywords, numbers and punctuation have their own syntax tokens.
  These apply only inside code, where token type supplies their meaning.

### Neutral

- **White stock** (`paper`) and **dark ink** (`ink`) carry ordinary content.
- **Muted ink** (`muted`) carries secondary explanation and line references.
- **Fine rule** (`rule`) divides groups; `field-border` outlines editable fields.
- **Soft wash** (`wash`) separates code and inactive or visited surfaces.

**The Meaning Before Color Rule.** Blue identifies focus and selection; green identifies achieved or added state; amber asks for review or marks facts made false; red identifies corrections and errors. Keep the accompanying labels and structural cues.

## Typography

Literata is self-hosted for principal headings and the expert's description;
Public Sans is self-hosted for controls, findings and model interpretation.
The system mono stack is reserved for code, line numbers and timing metrics.

The normative type roles above describe the intake display, working headline,
section title, base body, source sentence, field label and code block. In the
working sheet, source prose drops to 15px at the compact desktop breakpoint;
the run headline drops to 26px on small screens. Secondary guidance is usually
12–13px; microcopy for source references and routing metrics is 10–11px. These
small annotations are secondary, not a general-purpose body-text scale.
Paragraphs are capped at 72ch; reading guidance uses 65ch.

**The Two Reading Voices Rule.** Use Literata for source prose and principal headings, Public Sans for operation and interpretation, and mono for formal notation and numeric references.

## Layout

The desktop working sheet has a narrow routing slip and a flexible proof region,
within a centered 1800px maximum width and 40px page gutters. Description and
annotations sit side by side; the source and routing slip remain within reach
through sticky positioning. The gate bar is sticky at the bottom on desktop.
Spacing is compact inside groups and larger between them; the frontmatter names
recurring steps, rather than imposing a uniform grid on every measurement.

Plan review uses a full-width workspace and a horizontal routing slip. Its
horizontal progression connects Start and each action; selecting a position
shows the corresponding changes, goals and current facts. Fact lists have a
stable 18rem scroll area so additions and removals do not move the controls.

Description and construction are independently revealed with buttons.
Description starts hidden in Plan. Construction occupies a separate right
column on wide screens, with independently scrollable highlighted code blocks.
Reference layout responds to the working sheet width: at 1150px and below,
show the description above the plan and construction columns; at 750px and
below, stack all panels in reading order. Reflowed source regions are limited
to 32vh. Plan changes and current facts form two columns only when each can
retain at least 240px. At viewport widths of 850px and below, the routing slip
scrolls horizontally and the gate returns to normal flow. At 1100px page gutters
reduce to 24px; at 500px header controls and paired fields stack. Do not create
page-wide horizontal scrolling to preserve the desktop composition.

## Elevation & Depth

Surfaces remain flat. Fine rules, whitespace and pale state washes convey
hierarchy. Inset lines under the current stage and selected source are emphasis
marks, not floating-card elevation. No decorative shadows are used.

**The Flat Sheet Rule.** Use rules, spacing and tonal selection to separate regions. Do not add ornamental shadows or simulated paper texture.

## Shapes

Sheets and annotations are rectangular. Controls have only a slight corner
softening through the control-radius token. Buttons and fields use fine borders;
compact, outlined stamps denote actual state. The current timeline position
has a stronger 2px outline as well as its tint and step label. Avoid turning
ordinary annotations into separate rounded cards.

## Components

### Buttons

Primary buttons are blue with white text; secondary buttons are white with an
ink outline; quiet actions remove the visible border. Default buttons have a
38px minimum height, with smaller variants in the proof toolbar. Show/Hide
controls for both description and construction use buttons with `aria-expanded`
and `aria-controls`. Disabled controls use muted text, a neutral rule and wash.
Keyboard focus has a 2px blue outline offset by 4px.

### Inputs / Fields

Fields have visible labels, white fill, a fine neutral border and a 42px minimum
height. Textareas can resize vertically; the process description uses the prose
face. Inputs share the blue caret and focus outline. Error findings remain
visible near the edited result, and rejected input is retained for correction.

### Navigation

The routing slip displays stage name, status and available metrics. Current
location uses blue text, a pale blue fill and an inset underline; accepted stages
carry green passed stamps. Plan progression uses connected rectangular buttons,
a stronger outline for the current position, and subdued visited surfaces.
Neither navigation pattern communicates state through hue alone.

### Proof annotations and findings

Selecting a source sentence or its model annotation highlights the corresponding
content. Model meaning comes first; optional notation reveals variables and
participant roles. Native disclosure arrows fold reading guidance and findings.
Author questions and missing-reference warnings start collapsed inside the
relevant action; blocking errors start open. The source quote remains available
for review rather than being silently converted into inferred evidence.

### Plan walkthrough

Show the selected step's effects alongside the current facts and goals. Label
changes as Made true or Made false, with green and amber emphasis respectively.
Keep ordinary fact removal separate from error styling. Advanced action choices
and planner notation live in disclosures. A passed stamp is conditional on the
recorded review and goal state, not decoration.

### Construction

Construction is a separate reference pane containing typed results and Domain
and Problem PDDL. Code uses a quiet neutral background with token highlighting,
wrapping and scroll access. Highlighting preserves the literal content; it does
not inject rendered markup from generated text.

Selection receives a brief 180ms ease-out background transition only when the
user has not requested reduced motion. There is no ornamental motion.

## Do's and Don'ts

### Do:

- Do connect selected annotations to recorded source evidence, or label missing references.
- Do keep state labels, borders and disclosure controls alongside color.
- Do keep description and construction visibility controls as buttons with Show/Hide wording.
- Do present plain-language meaning before optional model notation.
- Do distinguish a passed model check from a claim that the described process is correct.

### Don't:

- Don't assign a different accent hue to every stage.
- Don't hide model omissions or silently fabricate source references.
- Don't use decorative imagery, paper texture or ornamental shadows.
- Don't use color alone to communicate a correction, selection or completed state.
