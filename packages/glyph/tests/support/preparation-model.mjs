// One description of the preparation model, run against every integration.
//
// A host mounts labels through its integration and exposes each as `{ value, set, setStyle, read,
// committed, paint, move, onLayout, onError }`, plus `frame()`, the step its renderer performs once
// per frame, and `prepare()`, the explicit `glyph.prepare()`. `onLayout(listener)` and
// `onError(listener)` attach through the integration's own surface: a property, a prop or an event.
// Every statement here is about what an author observes; the engine calls behind it are budgeted
// separately.
import assert from 'node:assert/strict';
import test from 'node:test';

const size = (summary) => ({
  width: summary.width,
  height: summary.height,
  lineCount: summary.lineCount,
  glyphCount: summary.glyphCount,
});

export function preparationModel(name, mount) {
  const scenario = (title, labels, run) =>
    test(`${name}: ${title}`, async () => {
      const host = await mount(labels);
      try {
        await run(host);
      } finally {
        await host.unmount();
      }
    });

  scenario('a read after a setter answers for the new value', ['short', 'a much longer label'], async (host) => {
    const [subject, reference] = host.texts;
    const expected = size(reference.read());
    subject.set('a much longer label');
    assert.equal(subject.value(), 'a much longer label');
    assert.deepEqual(size(subject.read()), expected);
  });

  scenario('every read between setters is current', ['one', 'two words', 'three more words'], async (host) => {
    const [subject, second, third] = host.texts;
    const expectedSecond = size(second.read());
    const expectedThird = size(third.read());
    subject.set('two words');
    assert.deepEqual(size(subject.read()), expectedSecond);
    subject.set('three more words');
    assert.deepEqual(size(subject.read()), expectedThird);
    await host.frame();
    assert.deepEqual(size(subject.read()), expectedThird);
  });

  scenario('a frame publishes what setters left unread', ['first', 'second', 'replacement'], async (host) => {
    const [first, second, reference] = host.texts;
    await host.frame();
    first.set('replacement');
    second.set('replacement');
    await host.frame();
    if (first.committed !== undefined) {
      assert.equal(first.committed(), true);
      assert.equal(second.committed(), true);
    }
    assert.deepEqual(size(first.read()), size(reference.read()));
    assert.deepEqual(size(second.read()), size(reference.read()));
  });

  scenario('an overwritten value is never observable', ['start', 'final value'], async (host) => {
    const [subject, reference] = host.texts;
    await host.frame();
    subject.set('an intermediate value nobody reads');
    subject.set('final value');
    await host.frame();
    assert.equal(subject.value(), 'final value');
    assert.deepEqual(size(subject.read()), size(reference.read()));
  });

  scenario('a read does not hold back the frame for its siblings', ['a', 'b', 'changed'], async (host) => {
    const [first, second, reference] = host.texts;
    await host.frame();
    first.set('changed');
    second.set('changed');
    first.read();
    await host.frame();
    if (second.committed !== undefined) assert.equal(second.committed(), true);
    assert.deepEqual(size(second.read()), size(reference.read()));
  });

  scenario('invalid input throws from the setter and keeps the previous value', ['kept'], async (host) => {
    const [subject] = host.texts;
    const before = size(subject.read());
    assert.throws(() => subject.setStyle({ fontSize: Number.NaN }), {
      name: 'GlyphInputError',
      code: 'invalid-input',
      path: ['style'],
    });
    assert.equal(subject.value(), 'kept');
    assert.deepEqual(size(subject.read()), before);
    await host.frame();
    assert.deepEqual(size(subject.read()), before);
  });

  scenario(
    'a layout callback receives each new summary once, before the frame that draws it',
    ['short', 'a much longer label'],
    async (host) => {
      const [subject, reference] = host.texts;
      const seen = [];
      subject.onLayout((layout) => seen.push(size(layout)));
      await host.frame();
      assert.deepEqual(seen, [size(subject.read())], 'the first preparation is a new summary');
      await host.frame();
      subject.paint('#ff0000');
      await host.frame();
      subject.move();
      await host.frame();
      assert.equal(seen.length, 1, 'neither a repeated frame, a colour nor a transform is a new layout');
      subject.set('a much longer label');
      assert.deepEqual(size(subject.read()), size(reference.read()));
      assert.equal(seen.length, 1, 'a read prepares the text and tells nobody');
      await host.frame();
      assert.deepEqual(seen, [seen[0], size(reference.read())]);
      if (subject.committed !== undefined) assert.equal(subject.committed(), true);
    },
  );

  scenario(
    'glyph.prepare() runs layout callbacks and the frame after it does not repeat them',
    ['label'],
    async (host) => {
      const [subject] = host.texts;
      const seen = [];
      subject.onLayout((layout) => seen.push(size(layout)));
      host.prepare();
      assert.deepEqual(seen, [size(subject.read())]);
      await host.frame();
      assert.equal(seen.length, 1);
    },
  );

  scenario(
    'a layout callback may paint and move, and a layout input it writes is refused',
    ['one', 'two'],
    async (host) => {
      const [subject, other] = host.texts;
      let calls = 0;
      let refusal;
      subject.onLayout(() => {
        calls += 1;
        other.paint('#00ff00');
        other.move();
        try {
          other.set('three');
        } catch (error) {
          refusal = error;
        }
      });
      await host.frame();
      assert.equal(calls, 1);
      assert.equal(refusal?.name, 'GlyphLayoutPhaseError');
      assert.equal(refusal?.code, 'layout-phase');
      assert.equal(other.value(), 'two', 'the refused write left the text as it was');
      if (other.committed !== undefined) {
        assert.equal(subject.committed(), true);
        assert.equal(other.committed(), true);
      }
      other.set('three');
      assert.equal(other.value(), 'three', 'the same write is accepted outside the callback');
    },
  );

  scenario('a layout callback that throws is reported and stops nothing', ['first', 'second'], async (host) => {
    const [first, second] = host.texts;
    const failure = new Error('layout callback failed');
    const reported = [];
    let secondCalls = 0;
    first.onError((error) => reported.push(error));
    first.onLayout(() => {
      throw failure;
    });
    second.onLayout(() => {
      secondCalls += 1;
    });
    await host.frame();
    assert.deepEqual(reported, [failure]);
    assert.equal(secondCalls, 1, 'the other callback still ran');
    if (first.committed !== undefined) {
      assert.equal(first.committed(), true, 'the frame still published');
      assert.equal(second.committed(), true);
    }
    await host.frame();
    assert.equal(reported.length, 1, 'the same summary is not handed over again');
  });

  scenario(
    'a text disposed inside a layout callback ends the frame cleanly',
    ['keeps', 'goes', 'self'],
    async (host) => {
      const [kept, removed, self] = host.texts;
      if (self.dispose === undefined) return;
      let calls = 0;
      self.onLayout(() => {
        calls += 1;
        removed.dispose();
        self.dispose();
      });
      await host.frame();
      await host.frame();
      assert.equal(calls, 1);
      assert.ok(kept.read().glyphCount > 0);
      if (kept.committed !== undefined) assert.equal(kept.committed(), true);
    },
  );
}
