import React, { useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { OFFLINE_AI_NOTICE } from '@shared/constants';
import type { ConversationThreadView } from '@shared/types';
import { Card } from '../common/Card.js';
import {
  useDismissReplyDraftMutation,
  useGetProductConversationsQuery,
  useRegenerateReplyMutation,
  useSendReplyDraftMutation,
} from '../../state/api/conversationsApi.js';
import { apiErrorMessage } from '../../state/api/envelope.js';
import { useAppDispatch } from '../../state/hooks.js';
import { enqueueToast } from '../../state/slices/uiSlice.js';
import { formatDateTime } from '../../utils/formatters.js';
import { INTENT_LABELS, describeActionError, isSendDisabled, threadPanel } from './conversationsState.js';

const POLL_INTERVAL_MS = 15_000;
const GENERIC_ERROR = 'Request failed';

interface DraftBoxProps {
  draft: NonNullable<ConversationThreadView['draft']>;
  sending: boolean;
  onSend: (text: string) => void;
  onDismiss: () => void;
}

const DraftBox: React.FC<DraftBoxProps> = ({ draft, sending, onSend, onDismiss }) => {
  const [text, setText] = useState(draft.text ?? '');
  const busy = sending || draft.status === 'sending';
  return (
    <Stack spacing={1}>
      {draft.intent && (
        <Typography variant="caption" color="text.secondary">
          {INTENT_LABELS[draft.intent]}
        </Typography>
      )}
      <TextField
        multiline
        minRows={2}
        fullWidth
        label="Reply"
        value={text}
        onChange={(event) => setText(event.target.value)}
        slotProps={{ htmlInput: { 'data-testid': 'reply-draft-text' } }}
      />
      {draft.offline && (
        <Typography variant="caption" color="text.secondary">
          {OFFLINE_AI_NOTICE}
        </Typography>
      )}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" size="small" disabled={isSendDisabled(busy)} onClick={() => onSend(text)}>
          Send
        </Button>
        <Button size="small" disabled={busy} onClick={onDismiss}>
          Dismiss
        </Button>
      </Stack>
    </Stack>
  );
};

export interface ConversationThreadProps {
  thread: ConversationThreadView;
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onDismiss: () => void;
  onRegenerate: () => void;
}

// Buyer text and drafts are React text nodes only: no HTML, no autolinking, no Markdown.
export const ConversationThread: React.FC<ConversationThreadProps> = ({
  thread,
  sending,
  error,
  onSend,
  onDismiss,
  onRegenerate,
}) => {
  const panel = threadPanel(thread);
  return (
    <Stack spacing={1.5} data-testid="conversation-thread">
      <Stack spacing={0.75}>
        {thread.messages.map((message) => (
          <Box
            key={message.id}
            sx={{ alignSelf: message.direction === 'buyer' ? 'flex-start' : 'flex-end', maxWidth: '85%' }}
          >
            <Typography variant="caption" color="text.secondary">
              {message.direction === 'buyer' ? 'Buyer' : 'You'} · {formatDateTime(message.sentAt)}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {message.text ?? 'Message deleted after the retention period.'}
            </Typography>
          </Box>
        ))}
      </Stack>
      {panel.kind === 'suspicious' && (
        <Alert severity="warning">
          This conversation looks suspicious: {panel.reasons.join(', ')}.
        </Alert>
      )}
      {panel.kind === 'draft' && thread.draft && (
        <DraftBox
          key={thread.draft.id}
          draft={thread.draft}
          sending={sending}
          onSend={onSend}
          onDismiss={onDismiss}
        />
      )}
      {panel.kind === 'sent' && (
        <Typography variant="body2" color="text.secondary">
          Sent
        </Typography>
      )}
      {panel.kind === 'failed' && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2">{panel.message}</Typography>
          <Button size="small" disabled={sending} onClick={onRegenerate}>
            Regenerate
          </Button>
        </Stack>
      )}
      {panel.kind === 'unclear_send' && (
        <Typography variant="body2">{panel.message}</Typography>
      )}
      {panel.kind === 'no_draft' && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2">No draft yet.</Typography>
          <Button size="small" disabled={sending} onClick={onRegenerate}>
            Regenerate
          </Button>
        </Stack>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
};

export const ConversationsSection: React.FC<{ productId: string }> = ({ productId }) => {
  const dispatch = useAppDispatch();
  const { currentData, refetch } = useGetProductConversationsQuery(productId, {
    pollingInterval: POLL_INTERVAL_MS,
  });
  const [sendDraft] = useSendReplyDraftMutation();
  const [dismissDraft] = useDismissReplyDraftMutation();
  const [regenerate] = useRegenerateReplyMutation();
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const threads = currentData ?? [];
  if (threads.length === 0) return null;

  const run = async (threadId: string, action: () => Promise<unknown>) => {
    setBusyThreadId(threadId);
    setErrors((current) => ({ ...current, [threadId]: null }));
    try {
      await action();
    } catch (err) {
      const { message, refetch: shouldRefetch } = describeActionError(err);
      if (message) setErrors((current) => ({ ...current, [threadId]: message }));
      else dispatch(enqueueToast({ message: apiErrorMessage(err) ?? GENERIC_ERROR, severity: 'error' }));
      if (shouldRefetch) void refetch();
    } finally {
      setBusyThreadId(null);
    }
  };

  return (
    <Card title="Conversations">
      <Stack spacing={3}>
        {threads.map((thread) => (
          <ConversationThread
            key={thread.id}
            thread={thread}
            sending={busyThreadId === thread.id}
            error={errors[thread.id] ?? null}
            onSend={(text) =>
              void run(thread.id, () =>
                sendDraft({ threadId: thread.id, draftId: thread.draft!.id, text }).unwrap()
              )
            }
            onDismiss={() =>
              void run(thread.id, () =>
                dismissDraft({ threadId: thread.id, draftId: thread.draft!.id }).unwrap()
              )
            }
            onRegenerate={() => void run(thread.id, () => regenerate(thread.id).unwrap())}
          />
        ))}
      </Stack>
    </Card>
  );
};
