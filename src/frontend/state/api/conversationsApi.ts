// Buyer conversation endpoints, injected into the shared baseApi.
import type { ApiResponse, ConversationThreadView } from '@shared/types';
import { baseApi } from './baseApi.js';
import { unwrap } from './envelope.js';

interface DraftArg {
  threadId: string;
  draftId: string;
}

// A mutation invalidates on failure too, so a refused send (superseded, unclear) refetches the threads.
const refreshConversations = [
  { type: 'Conversation' as const, id: 'LIST' },
  { type: 'Awaiting' as const },
];

export const conversationsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getProductConversations: builder.query<ConversationThreadView[], string>({
      query: (productId) => `/products/${productId}/conversations`,
      transformResponse: (res: ApiResponse<{ threads: ConversationThreadView[] }>) => unwrap(res).threads,
      providesTags: (_result, _error, productId) => [
        { type: 'Conversation', id: productId },
        { type: 'Conversation', id: 'LIST' },
      ],
    }),

    getAwaitingCounts: builder.query<Record<string, number>, void>({
      query: () => '/conversations/awaiting',
      transformResponse: (res: ApiResponse<{ byProductId: Record<string, number> }>) => unwrap(res).byProductId,
      providesTags: [{ type: 'Awaiting' }],
    }),

    sendReplyDraft: builder.mutation<void, DraftArg & { text: string }>({
      query: ({ threadId, draftId, text }) => ({
        url: `/conversations/${threadId}/drafts/${draftId}/send`,
        method: 'POST',
        body: { text },
      }),
      invalidatesTags: refreshConversations,
    }),

    dismissReplyDraft: builder.mutation<void, DraftArg>({
      query: ({ threadId, draftId }) => ({
        url: `/conversations/${threadId}/drafts/${draftId}/dismiss`,
        method: 'POST',
      }),
      invalidatesTags: refreshConversations,
    }),

    regenerateReply: builder.mutation<void, string>({
      query: (threadId) => ({ url: `/conversations/${threadId}/regenerate`, method: 'POST' }),
      invalidatesTags: refreshConversations,
    }),
  }),
});

export const {
  useGetProductConversationsQuery,
  useGetAwaitingCountsQuery,
  useSendReplyDraftMutation,
  useDismissReplyDraftMutation,
  useRegenerateReplyMutation,
} = conversationsApi;
