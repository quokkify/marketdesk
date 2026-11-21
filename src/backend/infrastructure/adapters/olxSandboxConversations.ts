// Sandbox conversations for the OLX stub transport. In memory only: workers build a fresh adapter
// per job, so the state lives at module scope and resets when the process restarts.

export interface SandboxMessage {
  uuid: string;
  thread_uuid: string;
  created_at: string;
  type: 'received' | 'sent';
  text: string;
}

const SANDBOX_THREAD_FIXTURES = [
  { suffix: 'buyer', interlocutorId: 910001, text: 'Hi, is it still available?' },
  { suffix: 'haggle', interlocutorId: 910002, text: 'Would you take 50 zł?' },
  { suffix: 'scam', interlocutorId: 910003, text: 'Paid via OLX delivery, confirm here: https://olx-dostawa.pl/odbierz' },
] as const;

const threadsByAdvert = new Map<string, string[]>();
const advertByThread = new Map<string, string>();
const interlocutorByThread = new Map<string, number>();
const messagesByThread = new Map<string, SandboxMessage[]>();
let sentCounter = 0;

export function resetSandboxConversations(): void {
  threadsByAdvert.clear();
  advertByThread.clear();
  interlocutorByThread.clear();
  messagesByThread.clear();
  sentCounter = 0;
}

// The first read of an advert fixes the fixture timestamps, so repeated syncs see the same messages.
export function sandboxThreadsForAdvert(advertId: string): Record<string, unknown>[] {
  let ids = threadsByAdvert.get(advertId);
  if (!ids) {
    const createdAt = new Date().toISOString();
    ids = SANDBOX_THREAD_FIXTURES.map((fixture) => {
      const uuid = `sbx-${advertId}-${fixture.suffix}`;
      advertByThread.set(uuid, advertId);
      interlocutorByThread.set(uuid, fixture.interlocutorId);
      messagesByThread.set(uuid, [{
        uuid: `${uuid}-m1`,
        thread_uuid: uuid,
        created_at: createdAt,
        type: 'received',
        text: fixture.text,
      }]);
      return uuid;
    });
    threadsByAdvert.set(advertId, ids);
  }
  return ids.map((uuid) => ({
    uuid,
    advert_id: advertId,
    interlocutor_id: interlocutorByThread.get(uuid),
    total_count: messagesByThread.get(uuid)?.length ?? 0,
  }));
}

export function sandboxThreadMessages(threadUuid: string): SandboxMessage[] | null {
  return messagesByThread.get(threadUuid) ?? null;
}

function appendSandboxMessage(threadUuid: string, type: SandboxMessage['type'], uuid: string, text: string): SandboxMessage {
  const messages = messagesByThread.get(threadUuid);
  if (!messages) throw new Error('Unknown sandbox thread');
  const message: SandboxMessage = {
    uuid, thread_uuid: threadUuid, created_at: new Date().toISOString(), type, text,
  };
  messages.push(message);
  return message;
}

export function appendSandboxSellerMessage(threadUuid: string, text: string): string {
  sentCounter += 1;
  return appendSandboxMessage(threadUuid, 'sent', `sbx-msg-${sentCounter}`, text).uuid;
}

// For the sandbox-only test endpoint that simulates a buyer writing.
export function appendSandboxBuyerMessage(threadUuid: string, text: string): string {
  sentCounter += 1;
  return appendSandboxMessage(threadUuid, 'received', `sbx-buyer-msg-${sentCounter}`, text).uuid;
}
