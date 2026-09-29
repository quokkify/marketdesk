import assert from 'node:assert/strict';
import test from 'node:test';
import { removeHtmlComments } from './verify-brand-assets.mjs';

test('removes multiple HTML comments and preserves surrounding content', () => {
  assert.equal(removeHtmlComments('before<!-- first -->middle<!-- second -->after'), 'beforemiddleafter');
});

test('handles repeated and overlapping comment delimiters without exposing comment text', () => {
  assert.equal(removeHtmlComments('a<!-- outer <!-- inner -->hidden-->z'), 'ahidden-->z');
  assert.equal(removeHtmlComments('x<!---->y<!-- -->z'), 'xyz');
});

test('recognizes delimiters across adjacent text and leaves an unterminated comment hidden', () => {
  assert.equal(removeHtmlComments('left<!---->right'), 'leftright');
  assert.equal(removeHtmlComments('active<!-- secret <!-- still secret'), 'active');
});
