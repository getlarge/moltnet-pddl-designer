/** Readable predicate templates. The description owns the relationship's meaning. */
export function FactDefinition({
  name,
  description,
  parameters,
}: {
  name: string;
  description: string;
  parameters: unknown;
}) {
  const roles = (Array.isArray(parameters) ? parameters : []).flatMap(
    (value) =>
      value && typeof value.name === 'string' && typeof value.type === 'string'
        ? [{ name: value.name as string, type: value.type as string }]
        : [],
  );
  const seen = new Map<string, number>();
  const participants = roles.map((role) => {
    const count = (seen.get(role.type) ?? 0) + 1;
    seen.set(role.type, count);
    const repeated = roles.filter((p) => p.type === role.type).length > 1;
    return {
      ...role,
      label: role.type.replaceAll('-', ' ') + (repeated ? ` ${count}` : ''),
    };
  });
  // Match full parameter tokens, so ?b never changes ?block. Prefer longer names.
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const byName = [...participants].sort(
    (a, b) => b.name.length - a.name.length,
  );
  const pattern = byName.length
    ? new RegExp(
        byName
          .map(
            (p) =>
              `(?:${escape(p.type.replaceAll('-', ' '))}\\s+)?${escape(p.name)}(?![\\w-])`,
          )
          .join('|'),
        'gi',
      )
    : undefined;
  const parts: Array<string | { label: string }> = [];
  let cursor = 0;
  if (pattern) {
    for (const match of description.matchAll(pattern)) {
      const participant = byName.find((p) =>
        match[0].toLowerCase().endsWith(p.name.toLowerCase()),
      );
      if (!participant) continue;
      parts.push(description.slice(cursor, match.index), {
        label: participant.label,
      });
      cursor = match.index! + match[0].length;
    }
  }
  parts.push(description.slice(cursor));
  return (
    <div className="fact-definition">
      <p className="fact-statement">
        {description
          ? parts.map((part, i) =>
              typeof part === 'string' ? (
                part
              ) : (
                <strong className="fact-participant" key={i}>
                  {part.label}
                </strong>
              ),
            )
          : 'No meaning recorded. Add a description before approving this fact.'}
      </p>
      <div className="fact-roles">
        <span className="small">
          {participants.length ? 'Applies to' : 'Scope'}
        </span>
        {participants.length ? (
          <ol aria-label={`Participants in ${name}`}>
            {participants.map((p, i) => (
              <li key={i}>{p.label}</li>
            ))}
          </ol>
        ) : (
          <span>The whole situation · no participants</span>
        )}
      </div>
      <details className="fact-notation">
        <summary>Model notation</summary>
        <code>{`(${name}${roles.map((p) => ` ${p.name}`).join('')})`}</code>
        {participants.length > 0 && (
          <dl>
            {participants.map((p, i) => (
              <div key={i}>
                <dt>{p.name}</dt>
                <dd>
                  {p.label} · type {p.type}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </details>
    </div>
  );
}
