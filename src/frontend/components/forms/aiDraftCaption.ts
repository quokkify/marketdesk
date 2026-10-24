import type { ProductAIDraft } from '@shared/types';

// Caption above an AI product draft. A draft Hermes did not produce is labelled as a
// heuristic draft and never shows a confidence.
export function aiDraftCaption(
  draft: Pick<ProductAIDraft, 'mode' | 'source' | 'confidence'>
): string {
  if (draft.source === 'offline') return 'Heuristic draft (Hermes offline)';
  const caption = `Draft from ${draft.mode === 'photos' ? 'photos' : 'title'}`;
  return draft.confidence === null
    ? caption
    : `${caption} · confidence ${Math.round(draft.confidence * 100)}%`;
}
