import { parseUsage } from './parseUsage';

describe('parseUsage', () => {
  it('reads the token counts of a chat completion usage block', () => {
    expect(
      parseUsage({ usage: { prompt_tokens: 1840, completion_tokens: 412, total_tokens: 2252 } }),
    ).toEqual({ promptTokens: 1840, completionTokens: 412, totalTokens: 2252 });
  });

  it('reports every count as unknown when the body has no usage block', () => {
    expect(parseUsage({ choices: [] })).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
    expect(parseUsage(null)).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null });
  });

  it('treats negative, fractional and string counts as unknown, never as a number', () => {
    expect(
      parseUsage({ usage: { prompt_tokens: -1, completion_tokens: 1.5, total_tokens: '9' } }),
    ).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null });
  });
});
