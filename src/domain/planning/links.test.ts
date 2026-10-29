import { describe, expect, it } from 'vitest';
import { followersOf, inWorkOrder, possiblePredecessors } from './links';

const t = (id: string, sort: number) => ({ id, sort });

describe('the order of the work', () => {
  it('puts every task after what it follows, and otherwise keeps the order she entered them in', () => {
    const tasks = [t('finish', 10), t('cut', 20), t('pattern', 30), t('note', 40), t('sew', 50)];
    const links = [
      { from: 'pattern', to: 'cut' },
      { from: 'cut', to: 'sew' },
      { from: 'sew', to: 'finish' },
    ];
    expect(inWorkOrder(tasks, links).map((x) => x.id)).toEqual(['pattern', 'cut', 'note', 'sew', 'finish']);
  });

  it('ignores links to tasks not in the list, and never loses a task', () => {
    const tasks = [t('a', 1), t('b', 2)];
    expect(inWorkOrder(tasks, [{ from: 'x', to: 'a' }]).map((x) => x.id)).toEqual(['a', 'b']);
    // A loop cannot be stored, but if one were, its tasks would still be shown.
    const loop = inWorkOrder(tasks, [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ]);
    expect(loop.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('what a task may be linked after', () => {
  const tasks = ['pattern', 'cut', 'sew', 'press', 'other'].map((id, i) => t(id, i));
  const links = [
    { from: 'pattern', to: 'cut' },
    { from: 'cut', to: 'sew' },
    { from: 'sew', to: 'press' },
  ];

  it('knows everything that comes after a task', () => {
    expect([...followersOf('cut', links)].sort()).toEqual(['press', 'sew']);
    expect(followersOf('press', links).size).toBe(0);
  });

  it('offers neither itself, nor what it already follows, nor anything that would make a loop', () => {
    expect(possiblePredecessors('cut', tasks, links).map((x) => x.id)).toEqual(['other']);
    expect(possiblePredecessors('press', tasks, links).map((x) => x.id)).toEqual(['pattern', 'cut', 'other']);
    expect(possiblePredecessors('pattern', tasks, links).map((x) => x.id)).toEqual(['other']);
  });
});
