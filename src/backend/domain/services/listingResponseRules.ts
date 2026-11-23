// Pure rules of the listing response graph: facts (the stored sale verdict, cards read from OLX
// search pages) become ranked findings. No I/O and no AI here; messages are fixed copy.
import { createHash } from 'crypto';
import type {
  ProbeCard,
  ResponseFinding,
  ResponseFindingCode,
  ResponseProbe,
  SaleVerdict,
} from '../../../shared/types';

export const DEEP_POSITION = 20;
export const CROWDED_TOTAL = 500;

const MIN_WORD_LENGTH = 3;
const MIN_PRICED_CARDS = 3;

const RANK: readonly ResponseFindingCode[] = [
  'verdict_reason',
  'not_in_results',
  'deep_in_results',
  'price_high_among_top',
  'title_misses_query_words',
  'verdict_out_of_date',
  'no_verdict',
  'crowded_market',
  'probe_failed',
];

function normalise(text: string): string {
  return text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function words(text: string): string[] {
  return normalise(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function knownFindings(verdict: SaleVerdict | null, changedAt: Date): ResponseFinding[] {
  if (!verdict) {
    return [
      {
        code: 'no_verdict',
        message: 'The listing has not been analysed yet',
        action: 'run_analyze',
        evidence: {},
      },
    ];
  }
  const findings: ResponseFinding[] = [];
  for (const check of Object.values(verdict.checks)) {
    if (!check || (check.status !== 'fix' && check.status !== 'needs_human')) continue;
    for (const reason of check.reasons) {
      findings.push({
        code: 'verdict_reason',
        message: reason.message,
        action: check.refs.eventIds.length > 0 ? 'open_proposal' : 'run_analyze',
        evidence: {
          verdictCheck: check.check,
          verdictReasonCode: reason.code,
          eventIds: check.refs.eventIds,
        },
      });
    }
  }
  if (
    verdict.completedAt !== null &&
    changedAt.getTime() > new Date(verdict.completedAt).getTime()
  ) {
    findings.push({
      code: 'verdict_out_of_date',
      message: 'The listing changed after the last analysis',
      action: 'run_analyze',
      evidence: {},
    });
  }
  return findings;
}

export function locateOwn(
  cards: ProbeCard[],
  ownId: string
): { position: number | null; checked: number } {
  const organic = cards.filter((card) => !card.promoted);
  const index = organic.findIndex((card) => card.id === ownId);
  return { position: index === -1 ? null : index + 1, checked: organic.length };
}

export function missingQueryWords(query: string, title: string): string[] {
  const titleWords = words(title);
  const missing: string[] = [];
  for (const word of words(query)) {
    if (word.length < MIN_WORD_LENGTH || missing.includes(word)) continue;
    if (!titleWords.some((titleWord) => titleWord.startsWith(word))) missing.push(word);
  }
  return missing;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function probeFindings(
  probe: ResponseProbe,
  own: { id: string; title: string; price: number }
): ResponseFinding[] {
  if (probe.status !== 'ok') return [];
  const findings: ResponseFinding[] = [];
  const { position, checked } = locateOwn(probe.cards, own.id);
  const { query, total } = probe;

  if (position === null && probe.cards.some((card) => card.id !== own.id)) {
    findings.push({
      code: 'not_in_results',
      message: `Not found among the ${checked} organic results read for "${query}"`,
      action: 'edit_title',
      evidence: { query, checked, total },
    });
  } else if (position !== null && position > DEEP_POSITION) {
    findings.push({
      code: 'deep_in_results',
      message: `Position ${position} of ${total ?? 'many'} for "${query}"`,
      action: 'refresh_advert',
      evidence: { query, position, checked, total },
    });
  }

  const missingWords = missingQueryWords(query, own.title);
  if (missingWords.length > 0) {
    findings.push({
      code: 'title_misses_query_words',
      message: `The title lacks ${missingWords.map((word) => `"${word}"`).join(', ')} from the search "${query}"`,
      action: 'edit_title',
      evidence: { query, missingWords },
    });
  }

  const prices = probe.cards
    .slice(0, probe.firstPageSize)
    .filter((card) => !card.promoted && card.id !== own.id && card.price !== null)
    .map((card) => card.price as number);
  if (prices.length >= MIN_PRICED_CARDS && own.price > median(prices)) {
    const lowPrice = Math.min(...prices);
    const highPrice = Math.max(...prices);
    findings.push({
      code: 'price_high_among_top',
      message: `The price ${own.price} PLN is above the median of the top results (${lowPrice}-${highPrice} PLN) for "${query}"`,
      action: 'review_price',
      evidence: { query, ownPrice: own.price, lowPrice, highPrice },
    });
  }

  if (total !== null && total > CROWDED_TOTAL) {
    findings.push({
      code: 'crowded_market',
      message: `${total} adverts compete for "${query}"`,
      action: null,
      evidence: { query, total },
    });
  }
  return findings;
}

export function rankFindings(findings: ResponseFinding[]): ResponseFinding[] {
  const unique: ResponseFinding[] = [];
  for (const candidate of findings) {
    const same = unique.find(
      (kept) =>
        kept.code === candidate.code &&
        JSON.stringify(kept.evidence) === JSON.stringify(candidate.evidence)
    );
    if (!same) unique.push(candidate);
  }

  const merged: ResponseFinding[] = [];
  let titleFinding: ResponseFinding | null = null;
  for (const finding of unique) {
    if (finding.code !== 'title_misses_query_words') {
      merged.push(finding);
    } else if (!titleFinding) {
      titleFinding = {
        ...finding,
        evidence: { ...finding.evidence, missingWords: [...(finding.evidence.missingWords ?? [])] },
      };
      merged.push(titleFinding);
    } else {
      const union = new Set([
        ...(titleFinding.evidence.missingWords ?? []),
        ...(finding.evidence.missingWords ?? []),
      ]);
      titleFinding.evidence.missingWords = [...union];
      titleFinding.message = `The title lacks ${[...union].map((word) => `"${word}"`).join(', ')} from the searches`;
      delete titleFinding.evidence.query;
    }
  }
  return merged
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) => RANK.indexOf(a.finding.code) - RANK.indexOf(b.finding.code) || a.index - b.index
    )
    .map(({ finding }) => finding);
}

export function subjectFingerprint(input: {
  title: string;
  price: number;
  categoryId: string | null;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([input.title, input.price, input.categoryId]))
    .digest('hex');
}
