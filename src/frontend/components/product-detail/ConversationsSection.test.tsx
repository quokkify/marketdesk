import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConversationThreadView } from '@shared/types';
import { OFFLINE_AI_NOTICE } from '@shared/constants';
import { lightTheme } from '../../theme/lightTheme';
import { ConversationThread } from './ConversationsSection';

const noop = () => undefined;

function render(thread: ConversationThreadView, props: { sending?: boolean; error?: string | null } = {}) {
  return renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <ConversationThread
        thread={thread}
        sending={props.sending ?? false}
        error={props.error ?? null}
        onSend={noop}
        onDismiss={noop}
        onRegenerate={noop}
      />
    </ThemeProvider>
  );
}

const base: ConversationThreadView = {
  id: 't1',
  status: 'open',
  suspiciousReasons: [],
  messages: [{ id: 'm1', direction: 'buyer', text: 'Hi, is it still available?', sentAt: '2026-11-21T10:00:00Z' }],
  draft: null,
};

const pendingDraft = {
  id: 'd1',
  status: 'pending' as const,
  intent: 'haggle' as const,
  text: 'Yes, 90 zł works.',
  filledPrice: 90,
  failureReason: null,
  offline: false,
};

describe('ConversationThread markup', () => {
  it('rendersBuyerTextAsPlainText', () => {
    const html = render({
      ...base,
      messages: [
        { id: 'm1', direction: 'buyer', text: 'See <a href="https://evil.example">here</a> https://x.example', sentAt: '2026-11-21T10:00:00Z' },
      ],
    });
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;here&lt;/a&gt;');
    expect(html).not.toContain('<a href');
    expect(html).not.toContain('href="https://x.example"');
  });

  it('shows the draft box with the intent label, Send and Dismiss', () => {
    const html = render({ ...base, draft: pendingDraft });
    expect(html).toContain('Price question');
    expect(html).toContain('Yes, 90 zł works.');
    expect(html).toContain('>Send<');
    expect(html).toContain('>Dismiss<');
    expect(html).not.toContain(OFFLINE_AI_NOTICE);
  });

  it('shows the offline notice only for an offline draft', () => {
    expect(render({ ...base, draft: { ...pendingDraft, offline: true } })).toContain(OFFLINE_AI_NOTICE);
  });

  it('disables Send while the request is in flight', () => {
    const html = render({ ...base, draft: pendingDraft }, { sending: true });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Send</);
  });

  it('shows the warning labels and no draft box for a suspicious thread', () => {
    const html = render({
      ...base,
      status: 'suspicious',
      suspiciousReasons: ['foreign_link', 'message_flood'],
      draft: pendingDraft,
    });
    expect(html).toContain('Link outside OLX');
    expect(html).toContain('Message flood');
    expect(html).not.toContain('>Send<');
    expect(html).not.toContain('Yes, 90 zł works.');
  });

  it('offers Regenerate when there is no draft yet', () => {
    const html = render(base);
    expect(html).toContain('No draft yet.');
    expect(html).toContain('>Regenerate<');
  });

  it('explains a failed draft', () => {
    const html = render({ ...base, draft: { ...pendingDraft, status: 'failed', text: null, failureReason: 'iban' } });
    expect(html).toContain("Couldn&#x27;t write a safe reply (it contains bank or card details).");
    expect(html).not.toContain('Hermes');
    expect(html).toContain('>Regenerate<');
  });

  it('unclearSendHasNoRegenerate', () => {
    const html = render({
      ...base,
      draft: { ...pendingDraft, status: 'failed', failureReason: 'unclear_send' },
    });
    expect(html).toContain(
      'We couldn&#x27;t confirm the reply reached OLX. Check the conversation on OLX before replying again.'
    );
    expect(html).not.toContain('safe reply');
    expect(html).not.toContain('>Regenerate<');
    expect(html).not.toContain('>Send<');
  });

  it('shows Sent for a sent draft and the action error when present', () => {
    expect(render({ ...base, draft: { ...pendingDraft, status: 'sent' } })).toContain('Sent');
    expect(render({ ...base, draft: pendingDraft }, { error: 'Already sending…' })).toContain('Already sending…');
  });
});
