import { z } from "zod";

export const LIBRARY_KEY = "recall-lab-library-v3";
export const LEGACY_SETS_KEY = "recall-lab-study-sets-v2";
export const MAX_UNDO_EDITS = 20;

const cardSchema = z.object({
  id: z.string(), front: z.string(), back: z.string(),
  score: z.number().nullable(), attempts: z.number().int().nonnegative(),
  lastReviewed: z.number().optional(),
});
const setSchema = z.object({
  id: z.string(), name: z.string(), cards: z.array(cardSchema), createdAt: z.number(),
});
const progressSchema = cardSchema.pick({ id: true, score: true, attempts: true, lastReviewed: true });
const undoBase = z.object({ id: z.string(), label: z.string(), setId: z.string() });
const undoSchema = z.discriminatedUnion("kind", [
  undoBase.extend({ kind: z.literal("remove-set") }),
  undoBase.extend({ kind: z.literal("remove-cards"), cardIds: z.array(z.string()) }),
  undoBase.extend({ kind: z.literal("restore-set"), set: setSchema, index: z.number().int().nonnegative() }),
  undoBase.extend({ kind: z.literal("restore-card"), card: cardSchema, index: z.number().int().nonnegative() }),
  undoBase.extend({ kind: z.literal("restore-progress"), progress: z.array(progressSchema) }),
]);
const librarySchema = z.object({ sets: z.array(setSchema), history: z.array(undoSchema).max(MAX_UNDO_EDITS) });

export type StudyCard = z.infer<typeof cardSchema>;
export type StudySet = z.infer<typeof setSchema>;
export type UndoEdit = z.infer<typeof undoSchema>;
export type StudyLibrary = z.infer<typeof librarySchema>;
type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

// Keep the existing device-local library. Sets and recovery history share one
// atomic write, so a failed save never leaves a deletion without its undo data.
export function loadLibrary(storage: StorageReader): StudyLibrary {
  const saved = storage.getItem(LIBRARY_KEY);
  if (saved !== null) return librarySchema.parse(JSON.parse(saved));
  const legacy = storage.getItem(LEGACY_SETS_KEY);
  return { sets: legacy === null ? [] : z.array(setSchema).parse(JSON.parse(legacy)), history: [] };
}

export function saveLibrary(storage: StorageWriter, library: StudyLibrary) {
  storage.setItem(LIBRARY_KEY, JSON.stringify(library));
}

export function recordEdit(library: StudyLibrary, sets: StudySet[], edit: UndoEdit): StudyLibrary {
  return { sets, history: [...library.history.slice(-(MAX_UNDO_EDITS - 1)), edit] };
}

export function undoLastEdit(library: StudyLibrary): StudyLibrary {
  const edit = library.history.at(-1);
  if (!edit) return library;
  let sets = library.sets;
  if (edit.kind === "remove-set") {
    sets = sets.filter((set) => set.id !== edit.setId);
  } else if (edit.kind === "restore-set") {
    sets = [...sets];
    if (!sets.some((set) => set.id === edit.setId)) sets.splice(edit.index, 0, edit.set);
  } else {
    sets = sets.map((set) => {
      if (set.id !== edit.setId) return set;
      if (edit.kind === "remove-cards") {
        const addedIds = new Set(edit.cardIds);
        return { ...set, cards: set.cards.filter((card) => !addedIds.has(card.id)) };
      }
      if (edit.kind === "restore-card") {
        const cards = [...set.cards];
        if (!cards.some((card) => card.id === edit.card.id)) cards.splice(edit.index, 0, edit.card);
        return { ...set, cards };
      }
      const progress = new Map(edit.progress.map((card) => [card.id, card]));
      return {
        ...set,
        cards: set.cards.map((card) => {
          const previous = progress.get(card.id);
          return previous ? { ...card, ...previous, lastReviewed: previous.lastReviewed } : card;
        }),
      };
    });
  }
  return { sets, history: library.history.slice(0, -1) };
}
