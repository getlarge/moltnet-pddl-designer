import type { Issue } from './check.js';

export interface SourceSentence {
  line: number;
  text: string;
  start: number;
}
export function sourceSentences(description: string): SourceSentence[] {
  const segments = new Intl.Segmenter('en', { granularity: 'sentence' });
  return [...segments.segment(description)]
    .filter((s) => s.segment.trim())
    .map((s, i) => ({
      line: i + 1,
      text: s.segment.trim(),
      start: s.index,
    }));
}
export function checkSources(
  result: unknown,
  sentences: SourceSentence[],
): Issue[] {
  if (!result || typeof result !== 'object') return [];
  const issues: Issue[] = [];
  for (const [key, rows] of Object.entries(result)) {
    if (
      !['types', 'predicates', 'actions'].includes(key) ||
      !Array.isArray(rows)
    )
      continue;
    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object' || !Array.isArray(row.sourceLines))
        return;
      for (const line of row.sourceLines)
        if (!sentences.some((s) => s.line === line))
          issues.push({
            severity: 'error',
            code: 'source-line',
            path: `${key}[${index}].sourceLines`,
            message: `Source line ${line} is not in this description. Choose an existing line.`,
          });
    });
  }
  return issues;
}
/** Legacy action quotes link only on an exact, unique match; never guess. */
export function sourceLines(
  element: { sourceLines?: number[]; source?: string },
  sentences: SourceSentence[],
): number[] {
  if (Array.isArray(element.sourceLines) && element.sourceLines.length)
    return element.sourceLines.filter((n) =>
      sentences.some((s) => s.line === n),
    );
  const matches = sentences.filter(
    (s) =>
      s.text ===
      (typeof element.source === 'string' ? element.source.trim() : undefined),
  );
  return matches.length === 1 ? [matches[0].line] : [];
}
