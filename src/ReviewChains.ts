import type { ReviewItem } from './ReadingRegions';

export type ReviewChain = ReviewItem & { parts: string[]; evidence: string[] };

export function reviewChains(items: ReviewItem[]): ReviewChain[] {
  const outgoing = new Map<string, ReviewItem[]>();
  const incoming = new Map<string, number>();
  for (const item of items) {
    if (!item.second) continue;
    const edges = outgoing.get(item.first) ?? [];
    edges.push(item);
    outgoing.set(item.first, edges);
    incoming.set(item.second, (incoming.get(item.second) ?? 0) + 1);
  }

  const consumed = new Set<ReviewItem>();
  const chains: ReviewChain[] = [];
  for (const item of items) {
    if (consumed.has(item)) continue;
    const parts = [item.first];
    const evidence = new Set(item.evidence);
    let current = item;
    while (current.second && !parts.includes(current.second) && parts.length < 128) {
      consumed.add(current);
      parts.push(current.second);
      current.evidence?.forEach(reason => evidence.add(reason));
      const continuation = outgoing.get(current.second);
      if (incoming.get(current.second) !== 1 || continuation?.length !== 1 ||
          outgoing.get(current.first)?.length !== 1 || consumed.has(continuation[0])) break;
      current = continuation[0];
    }
    chains.push({...item, parts, evidence: [...evidence],
      reason: parts.length > 2 ? parts.length + ' 块正文可能属于同一段' : item.reason});
  }
  return chains;
}