import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { completer } from '../src/cli/interactive';

describe('interactive shell tab completion', () => {
  test('completes an unambiguous partial command word', () => {
    const [hits, replaced] = completer('conn');
    assert.deepEqual(hits, ['connect']);
    assert.equal(replaced, 'conn');
  });

  test('an ambiguous prefix offers every match', () => {
    const [hits] = completer('ru');
    assert.deepEqual(hits, ['run', 'runs']);
  });

  test('an empty line offers every command', () => {
    const [hits] = completer('');
    assert.ok(hits.includes('run'));
    assert.ok(hits.includes('connect'));
    assert.equal(hits.length, new Set(hits).size, 'no duplicates');
  });

  test('a word matching no command falls back to the full list, not empty', () => {
    // readline's own convention: an empty match array closes the menu instead
    // of showing "no matches" - falling back to the full list keeps Tab useful
    // even on a typo.
    const [hits] = completer('zzz');
    assert.ok(hits.length > 0);
  });

  test('completes a set key by scheme', () => {
    const [hits, replaced] = completer('set LLM_PROV');
    assert.deepEqual(hits, ['LLM_PROVIDER']);
    assert.equal(replaced, 'LLM_PROV');
  });

  test('completes an unset key case-insensitively', () => {
    const [hits] = completer('unset llm_mod');
    assert.deepEqual(hits, ['LLM_MODEL']);
  });

  test('offers no completion past the second word', () => {
    const [hits] = completer('set LLM_PROVIDER deep');
    assert.deepEqual(hits, []);
  });

  test('offers no key completion for a command that takes no key', () => {
    const [hits] = completer('run extra');
    assert.deepEqual(hits, []);
  });
});
