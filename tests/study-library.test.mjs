import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_KEY, LEGACY_SETS_KEY, MAX_UNDO_EDITS,
  loadLibrary, saveLibrary, recordEdit, undoLastEdit,
} from '../app/study-library.ts';

const card = (id, extra = {}) => ({ id, front: id, back: `Answer ${id}`, score: null, attempts: 0, ...extra });
const deck = (id, cards = [card('one'), card('two')]) => ({ id, name: id, cards, createdAt: 1 });
const change = (kind, data = {}) => ({ id: 'edit', setId: 'A', label: 'Test edit', kind, ...data });
const memoryStorage = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

test('one undo removes a full added batch by ID without reverting original-card progress', () => {
  const original = deck('A');
  const added = [card('three'), card('four')];
  let state = recordEdit({ sets: [original], history: [] },
    [{ ...original, cards: [...original.cards, ...added] }], change('remove-cards', { cardIds: ['three', 'four'] }));
  state = { ...state, sets: [{ ...state.sets[0], cards: state.sets[0].cards.map((c) => c.id === 'one' ? { ...c, score: 100, attempts: 1 } : c) }] };
  const undone = undoLastEdit(state);
  assert.deepEqual(undone.sets[0].cards.map((c) => c.id), ['one', 'two']);
  assert.equal(undone.sets[0].cards[0].score, 100);
  assert.equal(undone.history.length, 0);
  assert.equal(state.sets[0].cards.length, 4);
});

test('deleting a set restores its position, cards, and learning history after reload', () => {
  const removed = deck('A', [card('one', { score: 85, attempts: 4, lastReviewed: 123 })]);
  const rest = [deck('B'), deck('C')];
  const state = recordEdit({ sets: [rest[0], removed, rest[1]], history: [] }, rest,
    change('restore-set', { set: removed, index: 1 }));
  const storage = memoryStorage();
  saveLibrary(storage, state);
  const restored = undoLastEdit(loadLibrary(storage));
  assert.deepEqual(restored.sets, [rest[0], removed, rest[1]]);
});

test('the final deleted set can be restored from an empty library', () => {
  const removed = deck('A');
  const state = recordEdit({ sets: [removed], history: [] }, [], change('restore-set', { set: removed, index: 0 }));
  assert.deepEqual(undoLastEdit(state).sets, [removed]);
});

test('successive single-card deletes undo in reverse order with original progress', () => {
  const original = deck('A', [card('one'), card('two', { score: 55, attempts: 3 }), card('three')]);
  let state = { sets: [original], history: [] };
  for (const id of ['two', 'one']) {
    const current = state.sets[0];
    const index = current.cards.findIndex((c) => c.id === id);
    state = recordEdit(state, [{ ...current, cards: current.cards.filter((c) => c.id !== id) }],
      change('restore-card', { id, card: current.cards[index], index }));
  }
  assert.deepEqual(undoLastEdit(undoLastEdit(state)).sets, [original]);
});

test('mixed batch add, delete-card, and delete-set edits undo together correctly', () => {
  const original = deck('A');
  const added = card('three');
  let state = recordEdit({ sets: [original], history: [] }, [{ ...original, cards: [...original.cards, added] }],
    change('remove-cards', { cardIds: ['three'] }));
  state = recordEdit(state, [{ ...state.sets[0], cards: original.cards }], change('restore-card', { card: added, index: 2 }));
  state = recordEdit(state, [], change('restore-set', { set: state.sets[0], index: 0 }));
  for (let i = 0; i < 3; i++) state = undoLastEdit(state);
  assert.deepEqual(state, { sets: [original], history: [] });
});

test('undo reset restores recorded progress without changing another set', () => {
  const original = deck('A', [card('one', { score: 82, attempts: 5, lastReviewed: 200 })]);
  const other = deck('B', [card('else', { score: 100, attempts: 2 })]);
  const state = recordEdit({ sets: [original, other], history: [] }, [deck('A', [card('one')]), other],
    change('restore-progress', { progress: original.cards.map(({ id, score, attempts, lastReviewed }) => ({ id, score, attempts, lastReviewed })) }));
  assert.deepEqual(undoLastEdit(state).sets, [original, other]);
});

test('undo a new import leaves other sets unchanged', () => {
  const other = deck('B');
  const state = recordEdit({ sets: [other], history: [] }, [other, deck('A')], change('remove-set'));
  assert.deepEqual(undoLastEdit(state), { sets: [other], history: [] });
});

test('keep the newest 20 edits and persist history atomically with sets', () => {
  let state = { sets: [deck('A')], history: [] };
  for (let i = 0; i < 25; i++) state = recordEdit(state, state.sets, change('remove-cards', { id: String(i), cardIds: [] }));
  assert.equal(state.history.length, MAX_UNDO_EDITS);
  assert.equal(state.history[0].id, '5');
  const storage = memoryStorage();
  saveLibrary(storage, state);
  assert.deepEqual(loadLibrary(storage), state);
});

test('legacy sets migrate non-destructively and the new library becomes authoritative', () => {
  const storage = memoryStorage();
  const oldSets = [deck('A')];
  storage.setItem(LEGACY_SETS_KEY, JSON.stringify(oldSets));
  assert.deepEqual(loadLibrary(storage), { sets: oldSets, history: [] });
  saveLibrary(storage, { sets: [], history: [] });
  assert.deepEqual(loadLibrary(storage), { sets: [], history: [] });
  assert.equal(storage.getItem(LEGACY_SETS_KEY), JSON.stringify(oldSets));
});

test('unreadable data and failed writes raise errors instead of silently discarding data', () => {
  const storage = memoryStorage();
  storage.setItem(LIBRARY_KEY, '{broken');
  assert.throws(() => loadLibrary(storage));
  storage.setItem(LIBRARY_KEY, JSON.stringify({ sets: [{ id: 'bad' }], history: [] }));
  assert.throws(() => loadLibrary(storage));
  const state = { sets: [deck('A')], history: [] };
  assert.throws(() => saveLibrary({ setItem: () => { throw new Error('Quota exceeded'); } }, state));
  assert.equal(state.sets.length, 1);
  assert.equal(undoLastEdit(state), state);
});
