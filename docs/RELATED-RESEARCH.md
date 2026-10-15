# Related research

Reading list for natural-language planning-domain generation, temporal PDDL,
and process structure. Links point to public papers and project pages. This is
a selective reading list, not an exhaustive survey.

## Core papers

| Paper | Summary |
| --- | --- |
| [Acitelli et al., *Generating Domain Models for Automated Planning from Natural Language Descriptions* (IEEE CAI 2026)](https://eprints.cs.univie.ac.at/8721/) | Direct baseline for the staged extraction pipeline. Its stated future direction is temporal and durative PDDL; its implementation includes numeric fluents, while this repository currently does not. [Code](https://github.com/giacomo1096/NL2PDDL). |
| [Beamish, *Extracting Temporal PDDL Code from Natural Language using Large Language Models* (Queen's University capstone, 2022)](https://beamisha.github.io/documents/Beamish_Undergraduate_Thesis.pdf) | Extracts timed conditions and effects for individual durative actions. Includes a small [annotation dataset and code](https://github.com/QuMuLab/temporal-nl-to-pddl). |
| [Hu et al., *Text2World: Benchmarking Large Language Models for Symbolic World Model Generation* (Findings of ACL 2025)](https://aclanthology.org/2025.findings-acl.1337/) | Domain-generation benchmark with component-level and execution-based evaluation. A classical baseline; temporal semantics need new examples and metrics. |
| [Pyrih et al., *LLMs that Understand Processes: Instruction-tuning for Semantics-Aware Process Mining* (ICPM 2025)](https://arxiv.org/abs/2508.16270) | Studies generalization across process tasks. Process trees encode sequence, choice, parallelism, and loops; these are useful comparison structures, but process-tree parallelism is not durative PDDL concurrency. [Code](https://github.com/pirogtm7/it4pm). |
| [Norouzifar et al., *Bridging Domain Knowledge and Process Discovery Using Large Language Models* (AI4BPM 2024)](https://arxiv.org/abs/2408.17316) | Uses extracted rules and expert feedback to constrain discovery from event logs. Relevant to interactive elicitation and review, though its target is process mining rather than planning. [Code](https://github.com/aliNorouzifar/IMr-LLM). |

## Additional papers

| Paper | Summary |
| --- | --- |
| [Fox and Long, *PDDL2.1: An Extension to PDDL for Expressing Temporal Planning Domains* (JAIR 2003)](https://www.cs.cmu.edu/afs/cs/project/jair/pub/volume20/fox03a.pdf) | Defines semantics for durations, conditions at the start/end or over an interval, timed effects, and concurrency. |
| [Oswald et al., *Large Language Models as Planning Domain Generators* (ICAPS 2024)](https://research.ibm.com/publications/large-language-models-as-planning-domain-generators) | Evaluates generated domains by testing whether plans transfer between reference and generated models. This is a stronger semantic check than syntax or mere solvability. [Code](https://github.com/IBM/NL2PDDL). |
| [Zuo et al., *Planetarium: A Rigorous Benchmark for Translating Text to Structured Planning Languages* (NAACL 2025)](https://aclanthology.org/2025.naacl-long.560/) | Shows why parseability and solvability do not establish semantic correctness. Its equivalence benchmark targets **problem descriptions**, so its scores should not be compared directly with domain-generation scores. |
| [Huang et al., *SPAR: Scalable LLM-based PDDL Domain Generation for Aerial Robotics* (2025)](https://arxiv.org/abs/2509.13691) | Combines relevant-example retrieval with action-by-action feedback and several validation measures on a UAV-focused dataset. [Code](https://github.com/KumarRobotics/SPAR). |
| [Tantakoun et al., *ALPSBench: Can Large Language Models Reason Their Way Through Planning Formalisms?* (LM4Plan at ICAPS 2026)](https://icaps26.icaps-conference.org/files/workshops/lm4plan/5_ALPSBench_Can_Large_Language.pdf) | Benchmarks domain generation and action-schema diagnosis on 24 new classical PDDL domains. High plan executability often fails to imply semantic equivalence, a useful evaluation warning for temporal extensions. |
