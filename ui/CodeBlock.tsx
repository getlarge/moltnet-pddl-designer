import { useMemo } from 'react';

/** Highlight source as React text nodes; never interpret model output as HTML. */
export function CodeBlock({
  code,
  language,
  label,
}: {
  code: string;
  language: 'json' | 'pddl';
  label: string;
}) {
  const tokens = useMemo(() => {
    const pattern =
      language === 'json'
        ? /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/g
        : /;[^\r\n]*|:[\w-]+|\?[\w-]+|\b(?:define|domain|problem|and|or|not|when|exists|forall|imply)\b|[()]|\b\d+(?:\.\d+)?\b/gi;
    const result: Array<{ text: string; kind?: string }> = [];
    let end = 0;
    for (const match of code.matchAll(pattern)) {
      const start = match.index!;
      if (start > end) result.push({ text: code.slice(end, start) });
      const token = match[0];
      let kind: string;
      if (language === 'json') {
        kind = token.startsWith('"')
          ? /^\s*:/.test(code.slice(start + token.length))
            ? 'key'
            : 'string'
          : /^(true|false|null)$/.test(token)
            ? 'keyword'
            : /^-?\d/.test(token)
              ? 'number'
              : 'punctuation';
      } else {
        kind = token.startsWith(';')
          ? 'comment'
          : token.startsWith('?')
            ? 'variable'
            : /^[()]$/.test(token)
              ? 'punctuation'
              : /^\d/.test(token)
                ? 'number'
                : 'keyword';
      }
      result.push({ text: token, kind });
      end = start + token.length;
    }
    if (end < code.length) result.push({ text: code.slice(end) });
    return result;
  }, [code, language]);
  return (
    <pre className="syntax-code" tabIndex={0} aria-label={label}>
      <code>
        {tokens.map((token, i) =>
          token.kind ? (
            <span className={`syntax-${token.kind}`} key={i}>
              {token.text}
            </span>
          ) : (
            token.text
          ),
        )}
      </code>
    </pre>
  );
}
