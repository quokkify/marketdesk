// Test-only helpers for reading renderToStaticMarkup() output; not a sanitizer. Emotion
// emits one lowercase <style> element per rule next to the markup; tests never assert on
// that CSS, so it is cut out before the markup is inspected. The blocks are located by
// scanning rather than deleted with a single-pass regex replace: that is exact (CSS text
// may contain ">") and is not the pattern CodeQL's incomplete-multi-character-sanitization
// check looks for.

const STYLE_CLOSE = '</style>';

/** The markup with every <style> element (tag and CSS text) removed. */
export function withoutStyleTags(html: string): string {
  const openTag = /<style[\s>]/g;
  let kept = '';
  let cursor = 0;
  for (let open = openTag.exec(html); open; open = openTag.exec(html)) {
    const close = html.indexOf(STYLE_CLOSE, open.index);
    if (close === -1) {
      throw new Error(`Unterminated <style> element at offset ${open.index} of the markup`);
    }
    kept += html.slice(cursor, open.index);
    cursor = close + STYLE_CLOSE.length;
    openTag.lastIndex = cursor;
  }
  return kept + html.slice(cursor);
}

/**
 * The text of the markup with each run of tags collapsed to one "|", so assertions can
 * check reading order (`text.indexOf('Menu') < text.indexOf('Dashboard')`) and adjacency
 * (`/\|Hermes AI\|3\|/`) without depending on the element structure.
 */
export function textOf(html: string): string {
  return withoutStyleTags(html)
    .replace(/<[^>]+>/g, '|')
    .replace(/\|+/g, '|');
}
