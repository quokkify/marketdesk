import { textOf, withoutStyleTags } from './staticMarkup';

describe('withoutStyleTags', () => {
  it('cuts out Emotion style elements, including CSS that contains ">"', () => {
    const html =
      '<style data-emotion="css a1">.a1>.b{color:red}</style>' +
      '<div class="a1"><style data-emotion="css b2">.b2{}</style><span>Hi</span></div>';

    expect(withoutStyleTags(html)).toBe('<div class="a1"><span>Hi</span></div>');
  });

  it('leaves markup without style elements untouched', () => {
    expect(withoutStyleTags('<p>no styles</p>')).toBe('<p>no styles</p>');
  });

  it('ignores other tags and escaped text that merely start with "<style"', () => {
    const html = '<styled-x>keep</styled-x>&lt;style&gt;';

    expect(withoutStyleTags(html)).toBe(html);
  });

  it('refuses an unterminated style element instead of guessing', () => {
    expect(() => withoutStyleTags('<p>a</p><style>.a{}')).toThrow('Unterminated <style>');
  });
});

describe('textOf', () => {
  it('keeps the text in reading order with one separator per run of tags', () => {
    const html =
      '<style>.x{}</style><nav><h2>Menu</h2>' +
      '<ul><li><a>Dashboard</a></li><li><a>Hermes AI</a><span>3</span></li></ul></nav>';

    expect(textOf(html)).toBe('|Menu|Dashboard|Hermes AI|3|');
  });
});
