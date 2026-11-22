// The photos check of the sale verdict: one code node on the photo count. A later vision node
// replaces its body and keeps the check shape.

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { VerdictCheck } from '../../../../shared/types';
import { photosCheck } from '../../../domain/services/saleVerdictRules';
import type { CheckContext, CheckGraph } from './SaleVerdictGraph';

const PhotosState = Annotation.Root({
  imageCount: Annotation<number>(),
  check: Annotation<VerdictCheck | null>(),
});

export function buildPhotosCheck(): CheckGraph {
  return async (ctx: CheckContext) => {
    const graph = new StateGraph(PhotosState)
      .addNode('count', (state: typeof PhotosState.State) => ({ check: photosCheck(state.imageCount, ctx.now()) }))
      .addEdge(START, 'count')
      .addEdge('count', END)
      .compile();
    const { check } = await graph.invoke({ imageCount: ctx.product.imageCount, check: null });
    if (!check) throw new Error('The photos check produced no result');
    return check;
  };
}
