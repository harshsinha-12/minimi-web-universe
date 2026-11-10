export function researchPolicy(
  question: string,
  forceSearch: boolean,
  historical: boolean,
) {
  const noSearch =
    /\b(?:don['’]t|do not|never)\s+(?:use\s+)?(?:the\s+)?(?:web\s+)?(?:search|browse)|\bwithout (?:web )?search|\bno (?:web )?search\b/i.test(
      question,
    );
  const recheck =
    /\b(since|changed|still (correct|true|accurate)|recheck|verify|up.to.date)\b/i.test(
      question,
    );
  const fresh =
    /\b(today|latest|current|pricing|price|release|news|cost|best|recommend|compare|weather|search|research|who (is|are)|when did)\b/i.test(
      question,
    );
  const required = !noSearch && (forceSearch || recheck || fresh);
  return { recheck, required, allow: !noSearch && !(historical && !required) };
}
