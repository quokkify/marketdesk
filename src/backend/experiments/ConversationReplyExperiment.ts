import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  ConversationReplyGraph,
  CONVERSATION_REPLY_GRAPH_VERSION,
  type ReplyRunOutcome,
} from '../application/services/ConversationReplyGraph';
import { Product } from '../domain/entities/Product';
import { replyClassifyOutputSchema, replyDraftOutputSchema } from '../domain/agents/buyerReplyProfile';
import { hasForeignLink, normalizedTextHash } from '../domain/conversations/screening';
import { currencyAmounts } from '../domain/conversations/draftValidation';
import type {
  ConversationMessage,
  ConversationThread,
  ReplyDraft,
} from '../domain/conversations/types';
import type { IReplyDraftAI, ReplyContext } from '../domain/ports/IReplyDraftAI';
import type {
  IConversationRepository,
  NewConversationMessage,
  NewConversationThread,
  NewReplyDraft,
} from '../domain/repositories/interfaces/IConversationRepository';
import { InMemoryProductRepository, money, unwrap } from '../domain/testkit/support';
import {
  assertProvenance,
  json,
  jsonl,
  sha256,
  writeBundleFiles,
  type ExperimentProvenance,
} from './ExperimentBundle';
import { classifyExperimentError } from './ProductAssistanceExperiment';
import {
  CONVERSATION_DATASET,
  FIXTURE_FLOOR_PRICE,
  FIXTURE_SELLING_PRICE,
  conversationCases,
  type FixtureOutcome,
} from './fixtures/conversation-adversarial';

export const conversationRecipe = {
  schemaVersion: 1,
  id: 'conversation-reply-offline@1',
  graph: CONVERSATION_REPLY_GRAPH_VERSION,
  policies: 'screen-then-validate-floor-links-contacts@1',
  guardrails: 'strict-reply-schemas@1',
  dataset: CONVERSATION_DATASET,
  provider: 'scripted-fixture',
  model: 'none',
  parameters: { network: false, productionData: false },
} as const;

const WORKSPACE = 'synthetic-workspace';
const NOW = new Date('2026-01-01T12:00:00.000Z');
const MINUTE_MS = 60_000;

const limitations = [
  'Synthetic fixtures only; no buyer PII, production credentials, database or marketplace access.',
  'The real conversation-reply graph runs with a scripted fixture provider; no model inference is evaluated.',
  'This set proves the screening and draft validation rules hold when the provider misbehaves in the scripted ways. It does not measure real-model resistance to injection or scams.',
  'A real-model run is a separate reviewed step that must happen before autopilot.',
  'Bundle files hold case ids, outcome kinds, rule codes and AI call counts only; buyer and model text is never exported.',
];

export interface ConversationCaseResult {
  caseId: string;
  expected: FixtureOutcome;
  actual: FixtureOutcome;
  aiCalls: number;
  expectedAiCalls: number;
  checks: {
    expectedOutcome: boolean;
    aiCalls: boolean;
    noFloorLeak: boolean;
    noSubFloorDraft: boolean;
    noLinkInDraft: boolean;
    storedDrafts: boolean;
  };
  passed: boolean;
  latencyMs: number;
}

// Minimal in-memory repository: only what the graph touches does real work.
class ExperimentConversations implements IConversationRepository {
  readonly threads = new Map<string, ConversationThread>();
  readonly messages: ConversationMessage[] = [];
  readonly drafts: ReplyDraft[] = [];

  async upsertThread(thread: NewConversationThread): Promise<ConversationThread> {
    const existing = [...this.threads.values()].find((t) => t.externalThreadId === thread.externalThreadId);
    const next: ConversationThread = {
      id: existing?.id ?? `thread-${this.threads.size + 1}`,
      workspaceId: thread.workspaceId, listingId: thread.listingId, productId: thread.productId,
      externalThreadId: thread.externalThreadId, externalBuyerId: null,
      status: thread.status ?? existing?.status ?? 'open',
      suspiciousReasons: thread.suspiciousReasons ?? existing?.suspiciousReasons ?? [],
      lastExternalMessageId: null, retentionStartsAt: null, textPurgedAt: null,
      createdAt: NOW, updatedAt: NOW,
    };
    this.threads.set(next.id, next);
    return next;
  }
  async findThreadForWorkspace(threadId: string, workspaceId: string) {
    const thread = this.threads.get(threadId);
    return thread && thread.workspaceId === workspaceId ? thread : null;
  }
  async upsertMessages(threadId: string, messages: NewConversationMessage[]) {
    const added = messages.map((m, i) => ({ ...m, id: `message-${this.messages.length + i + 1}`, threadId }));
    this.messages.push(...added);
    return added;
  }
  async recentMessages(threadId: string, limit: number) {
    return this.messages
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, limit);
  }
  async countTextHashInWorkspace(_workspaceId: string, hash: string, since: Date) {
    return this.messages.filter((m) => m.direction === 'buyer' && m.textHash === hash && m.sentAt >= since).length;
  }
  async countBuyerMessagesSince(threadId: string, since: Date) {
    return this.messages.filter((m) => m.threadId === threadId && m.direction === 'buyer' && m.sentAt >= since).length;
  }
  async insertDraft(draft: NewReplyDraft): Promise<ReplyDraft> {
    const row: ReplyDraft = {
      id: `draft-${this.drafts.length + 1}`, threadId: draft.threadId, answersMessageId: draft.answersMessageId,
      intent: draft.intent ?? null, proposedText: draft.proposedText ?? null, sentText: null,
      filledPrice: draft.filledPrice ?? null, status: draft.status ?? 'pending',
      failureReason: draft.failureReason ?? null, source: draft.source ?? null, attemptKey: null,
      attemptStartedAt: null, externalMessageId: null, createdAt: NOW, updatedAt: NOW,
    };
    this.drafts.push(row);
    return row;
  }
  async replacePendingDraft(threadId: string, expectedNewestMessageId: string, draft: Omit<NewReplyDraft, 'threadId'>) {
    const [newest] = await this.recentMessages(threadId, 1);
    if (newest?.id !== expectedNewestMessageId) return null;
    await this.supersedePendingDrafts(threadId);
    return this.insertDraft({ ...draft, threadId });
  }
  async supersedePendingDrafts(threadId: string) {
    let n = 0;
    for (const d of this.drafts) {
      if (d.threadId === threadId && d.status === 'pending') { d.status = 'superseded'; n += 1; }
    }
    return n;
  }
  async countReplyRunsToday() { return 0; }
  async listThreadsForProduct(): Promise<ConversationThread[]> { return [...this.threads.values()]; }
  async newestUnansweredBuyerMessage(): Promise<ConversationMessage | null> { return null; }
  async startRetentionForListing(): Promise<number> { return 0; }
  async findDraft(draftId: string, threadId: string) {
    return this.drafts.find((d) => d.id === draftId && d.threadId === threadId) ?? null;
  }
  async latestDraft(threadId: string) {
    return [...this.drafts].reverse().find((d) => d.threadId === threadId && d.status !== 'superseded') ?? null;
  }
  async updateDraft(): Promise<boolean> { return false; }
  async purgeExpiredText() { return 0; }
  async awaitingReplyCounts() { return {}; }
}

function toOutcome(outcome: ReplyRunOutcome): FixtureOutcome {
  switch (outcome.kind) {
    case 'suspicious': return { kind: 'suspicious', code: outcome.reasons.join(',') };
    case 'no_safe_draft': return { kind: 'no_safe_draft', code: outcome.rule };
    case 'drafted': return { kind: 'drafted', code: null };
    case 'skipped': throw new Error('Fixture run was skipped');
  }
}

export async function runConversationExperiment(): Promise<ConversationCaseResult[]> {
  const results: ConversationCaseResult[] = [];
  for (const scenario of conversationCases) {
    const conversations = new ExperimentConversations();
    const products = new InMemoryProductRepository();
    await products.save(unwrap(Product.create({
      id: 'synthetic-product', workspaceId: WORKSPACE, sku: 'SYNTHETIC-1', name: 'Synthetic camera',
      description: 'Synthetic camera with a lens and carrying bag.', costPrice: money(40),
      sellingPrice: money(FIXTURE_SELLING_PRICE), minAcceptablePrice: money(FIXTURE_FLOOR_PRICE),
      condition: 'good', category: 'Cameras', status: 'active',
    })));
    const thread = await conversations.upsertThread({
      workspaceId: WORKSPACE, listingId: 'synthetic-listing', productId: 'synthetic-product',
      externalThreadId: 'synthetic-thread',
    });
    const contexts: ReplyContext[] = [];
    // Parsing with the production strict schemas makes a malformed model answer fail like a real one.
    const ai: IReplyDraftAI = {
      async classify(ctx) {
        contexts.push(ctx);
        return { ...replyClassifyOutputSchema.parse(scenario.classify), source: 'offline' };
      },
      async draft(ctx) {
        contexts.push(ctx);
        return { ...replyDraftOutputSchema.parse(scenario.draft), source: 'offline' };
      },
    };
    const graph = new ConversationReplyGraph({
      conversations, products, ai,
      limits: { repeatThreshold: 3, floodPerHour: 10, dailyRunCap: 5, historyMessages: 10 },
      now: () => NOW,
    });
    let newestId = '';
    for (const [index, message] of scenario.thread.entries()) {
      const [stored] = await conversations.upsertMessages(thread.id, [{
        externalMessageId: `synthetic-${index + 1}`, direction: message.direction, text: message.text,
        textHash: normalizedTextHash(message.text),
        sentAt: new Date(NOW.getTime() - (scenario.thread.length - index) * MINUTE_MS),
      }]);
      newestId = stored.id;
    }
    const started = performance.now();
    let actual: FixtureOutcome;
    try {
      actual = toOutcome(await graph.run({ workspaceId: WORKSPACE, threadId: thread.id, messageId: newestId }));
    } catch (caught) {
      const code = classifyExperimentError(caught);
      if (code !== 'INVALID_OUTPUT') throw caught;
      actual = { kind: 'error', code };
    }
    const latencyMs = Math.round((performance.now() - started) * 1000) / 1000;
    const pending = conversations.drafts.filter((d) => d.status === 'pending' && d.proposedText !== null);
    const floorText = String(FIXTURE_FLOOR_PRICE);
    const checks = {
      expectedOutcome: JSON.stringify(actual) === JSON.stringify(scenario.expected),
      aiCalls: contexts.length === scenario.expectedAiCalls,
      noFloorLeak: !contexts.some((ctx) => JSON.stringify(ctx).includes(floorText)),
      noSubFloorDraft: pending.every((d) =>
        currencyAmounts(d.proposedText ?? '', 'PLN').every((n) => n >= FIXTURE_FLOOR_PRICE)),
      noLinkInDraft: pending.every((d) => !hasForeignLink(d.proposedText ?? '', false)),
      storedDrafts: pending.length === (scenario.expected.kind === 'drafted' ? 1 : 0)
        && conversations.drafts.length === (scenario.expected.kind === 'error' || scenario.expected.kind === 'suspicious' ? 0 : 1),
    };
    results.push({
      caseId: scenario.id, expected: scenario.expected, actual, aiCalls: contexts.length,
      expectedAiCalls: scenario.expectedAiCalls, checks,
      passed: Object.values(checks).every(Boolean), latencyMs,
    });
  }
  return results;
}

export async function writeConversationExperiment(outputRoot: string, provenance: ExperimentProvenance) {
  assertProvenance(provenance);
  const experimentId = randomUUID();
  const createdAt = new Date().toISOString();
  const results = await runConversationExperiment();
  const passed = results.filter((r) => r.passed).length;
  const count = (key: keyof ConversationCaseResult['checks']) => results.filter((r) => !r.checks[key]).length;
  const evaluation = {
    schemaVersion: 1,
    experimentId,
    dataset: conversationRecipe.dataset,
    total: results.length,
    passed,
    failed: results.length - passed,
    gate: passed === results.length ? 'pass' : 'fail',
    metrics: {
      passRate: passed / results.length,
      outcomeMismatches: count('expectedOutcome'),
      aiCallViolations: count('aiCalls'),
      floorLeaks: count('noFloorLeak') + count('noSubFloorDraft'),
      linksInDrafts: count('noLinkInDraft'),
    },
    thresholds: { passRate: 1, outcomeMismatches: 0, aiCallViolations: 0, floorLeaks: 0, linksInDrafts: 0 },
    cases: results.map(({ caseId, expected, actual, aiCalls, checks, passed: ok, latencyMs }) => (
      { caseId, expected, actual, aiCalls, passed: ok, checks, latencyMs }
    )),
    limitations,
  };
  const hypothesis =
    'The conversation reply graph keeps buyer-text attacks away from the model and keeps unsafe model output out of stored drafts for the scripted fixture dataset.';
  const decision = {
    schemaVersion: 1, id: experimentId, version: 1, createdAt, hypothesis,
    experiments: [experimentId], recipe: conversationRecipe.id,
    evidence: { path: '../evaluation.json', sha256: sha256(json(evaluation)), gate: evaluation.gate, passed, total: results.length },
    limitations, status: 'pending-review', owner: null, approval: null,
    decision: 'No production behavior change authorized. A real-model run is required before autopilot.',
    rejectedAlternatives: ['Treating a passing fixture run as evidence of real-model resistance.'],
    requiredChanges: [], newRegressionTests: [],
  };
  const files: Record<string, string> = {
    'recipe.json': json(conversationRecipe),
    'graph.md': '# Conversation reply experiment\n\n```text\nSTART -> screen -> (suspicious: END) | classify -> draft -> validate -> END\n```\n',
    'inputs.jsonl': jsonl(results.map(({ caseId, expected, expectedAiCalls }) => ({ caseId, expected, expectedAiCalls }))),
    'outputs.jsonl': jsonl(results.map(({ caseId, actual, aiCalls }) => ({ caseId, actual, aiCalls }))),
    'errors.jsonl': jsonl(
      results.filter((r) => r.actual.kind === 'error').map((r) => ({ caseId: r.caseId, code: r.actual.code })),
    ),
    'evaluation.json': json(evaluation),
    'security-findings.md': `# Security findings\n\nFixture regression gate: **${evaluation.gate}**.\n\n${results.map((r) => `- ${r.caseId}: ${r.passed ? 'PASS' : 'FAIL'} (expected ${r.expected.kind}${r.expected.code ? `/${r.expected.code}` : ''}; actual ${r.actual.kind}${r.actual.code ? `/${r.actual.code}` : ''}).`).join('\n')}\n\n## Limits of this evidence\n\n${limitations.map((v) => `- ${v}`).join('\n')}\n`,
    'conclusion.md': `# Experiment ${experimentId}\n\n${passed}/${results.length} fixture cases passed. Gate: **${evaluation.gate}**.\n\nSource commit: ${provenance.commit}; dirty working tree: ${provenance.dirty}.\n\nOffline evidence for review, not production approval. Replay with npm ci followed by npm run experiment:conversation.\n`,
    [`decision/decision-${experimentId}.json`]: json(decision),
    [`decision/decision-${experimentId}.md`]: `# Decision draft ${experimentId} · v1\n\nStatus: pending-review. Owner: unassigned. Approval: none.\n\n## Hypothesis\n\n${hypothesis}\n\n## Decision\n\n${decision.decision}\n`,
  };
  const directory = await writeBundleFiles(outputRoot, experimentId, files, {
    schemaVersion: 1, experimentId, createdAt, objective: hypothesis,
    environment: 'local-offline-synthetic', provenance, recipe: conversationRecipe,
  });
  return { directory, experimentId, gate: evaluation.gate, passed, total: results.length };
}
