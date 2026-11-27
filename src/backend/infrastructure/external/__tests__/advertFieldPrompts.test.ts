import type { OlxCategoryAttribute } from '../../../domain/services/advertCompletenessRules';
import {
  buildAttributeChoicePrompt,
  buildParcelSizePrompt,
  parseAttributeChoices,
  parseParcelSize,
} from '../advertFieldPrompts';
import type { ResearchItem } from '../priceResearchPrompts';

const ITEM: ResearchItem = {
  name: 'Epson EH-TW650',
  condition: 'used_good',
  category: 'Projektory',
  currency: 'PLN',
};

const ATTRIBUTES: OlxCategoryAttribute[] = [
  {
    code: 'brand',
    label: 'Marka',
    required: true,
    multiple: false,
    values: [
      { code: 'epson', label: 'Epson' },
      { code: 'benq', label: 'BenQ' },
    ],
  },
  {
    code: 'resolution',
    label: 'Rozdzielczość',
    required: false,
    multiple: false,
    values: [
      { code: 'fullhd', label: 'Full HD' },
      { code: 'hd', label: 'HD' },
    ],
  },
];

describe('buildAttributeChoicePrompt', () => {
  it('lists every attribute code, label and allowed value code with label', () => {
    const { system, prompt } = buildAttributeChoicePrompt(ITEM, ATTRIBUTES);
    for (const word of ['brand', 'Marka', 'epson', 'Epson', 'benq', 'BenQ', 'resolution', 'fullhd', 'Full HD', 'hd']) {
      expect(prompt).toContain(word);
    }
    expect(prompt).toContain('Epson EH-TW650');
    expect(prompt).toContain('null');
    expect(system).toContain('<seller_data>');
  });

  it('lists only the attributes given', () => {
    const { prompt } = buildAttributeChoicePrompt(ITEM, [ATTRIBUTES[0]]);
    expect(prompt).not.toContain('resolution');
  });
});

describe('parseAttributeChoices', () => {
  it('keeps valid pairs', () => {
    const raw = '{"values":{"brand":"epson","resolution":"hd"}}';
    expect(parseAttributeChoices(raw, ATTRIBUTES)).toEqual([
      { code: 'brand', value: 'epson' },
      { code: 'resolution', value: 'hd' },
    ]);
  });

  it('drops a value outside the list, an unknown code and null', () => {
    const raw = '{"values":{"brand":"sony","resolution":null,"color":"red"}}';
    expect(parseAttributeChoices(raw, ATTRIBUTES)).toEqual([]);
  });

  it('drops non-string values', () => {
    expect(parseAttributeChoices('{"values":{"brand":1}}', ATTRIBUTES)).toEqual([]);
  });

  it('accepts one fenced json block and nothing else', () => {
    const body = '{"values":{"brand":"benq"}}';
    expect(parseAttributeChoices('```json\n' + body + '\n```', ATTRIBUTES)).toEqual([
      { code: 'brand', value: 'benq' },
    ]);
    expect(parseAttributeChoices('Sure!\n```json\n' + body + '\n```', ATTRIBUTES)).toEqual([]);
    expect(parseAttributeChoices('```json\n' + body + '\n```\nDone.', ATTRIBUTES)).toEqual([]);
    expect(parseAttributeChoices('Here: ' + body, ATTRIBUTES)).toEqual([]);
  });

  it('returns [] for non-JSON or a wrong shape', () => {
    expect(parseAttributeChoices('not json', ATTRIBUTES)).toEqual([]);
    expect(parseAttributeChoices('{"values":[]}', ATTRIBUTES)).toEqual([]);
    expect(parseAttributeChoices('{}', ATTRIBUTES)).toEqual([]);
  });

  it('never returns a code twice', () => {
    const attributes = [ATTRIBUTES[0], ATTRIBUTES[0]];
    expect(parseAttributeChoices('{"values":{"brand":"epson"}}', attributes)).toEqual([
      { code: 'brand', value: 'epson' },
    ]);
  });
});

describe('buildParcelSizePrompt', () => {
  it('names the four sizes and carries the item', () => {
    const { system, prompt } = buildParcelSizePrompt(ITEM);
    for (const size of ['S', 'M', 'L', 'XL']) expect(prompt).toContain(`"${size}"`);
    expect(prompt).toContain('Epson EH-TW650');
    expect(system).toContain('<seller_data>');
  });
});

describe('parseParcelSize', () => {
  it('upper-cases and accepts S, M, L and XL', () => {
    expect(parseParcelSize('{"size":"m"}')).toBe('M');
    expect(parseParcelSize('{"size":"xl"}')).toBe('XL');
    expect(parseParcelSize('```json\n{"size":"S"}\n```')).toBe('S');
  });

  it('rejects anything else', () => {
    expect(parseParcelSize('{"size":"XXL"}')).toBeNull();
    expect(parseParcelSize('{"size":2}')).toBeNull();
    expect(parseParcelSize('{}')).toBeNull();
    expect(parseParcelSize('size M')).toBeNull();
    expect(parseParcelSize('Sure {"size":"M"}')).toBeNull();
  });
});
