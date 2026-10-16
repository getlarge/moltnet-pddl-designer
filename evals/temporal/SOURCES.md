# Temporal detection benchmark sources

`detection-v2.json` contains 32 cases across eight action families. Each family
has two descriptions copied from the public
[QuMuLab temporal NL-to-PDDL annotations](https://github.com/QuMuLab/temporal-nl-to-pddl/tree/61899bac8608baa719687adbbf0a9928fc06a106/AnnotationsDataset)
and two contrastive descriptions written by this project. The source snapshot
is commit `61899bac8608baa719687adbbf0a9928fc06a106`.

Original descriptions are used under the source repository's
[MIT License](https://github.com/QuMuLab/temporal-nl-to-pddl/blob/61899bac8608baa719687adbbf0a9928fc06a106/LICENSE):

> Copyright (c) 2022 beamisha
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

The positive labels are **project curated from each description**, not gold
labels supplied by the authors. Some source descriptions disagree with a
domain's PDDL record, so the annotation follows the visible paragraph alone.
The source only supplies positive timed descriptions; all negative cases are
project-authored controls. This benchmark tests whether a classifier identifies
an extractable numeric or symbolic duration, or a timed condition or effect,
**for the named action**. Ordering, an unrelated clock or deadline, a schedule
for another action, and qualitative speed alone are negative. The `mapanalyzer`
family exercises symbolic duration (`distance / speed`).

The split is by family: four families in `dev`, four in `holdout`. Related
paraphrases and their controls never cross splits. A score over 32 descriptions
still represents only eight source action families, and the negatives do not
measure robustness on independently collected prose. Keep holdout descriptions
out of prompts and retrieval examples.
