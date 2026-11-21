// One description of the preparation model, run against every integration.
//
// A host mounts labels through its integration and exposes each as `{ value, set, setStyle, read,
// committed }`, plus `frame()`, the step its renderer performs once per frame. Every statement here
// is about what an author observes; the engine calls behind it are budgeted separately.
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
    assert.throws(() => subject.setStyle({ fontSize: Number.NaN }));
    assert.equal(subject.value(), 'kept');
    assert.deepEqual(size(subject.read()), before);
    await host.frame();
    assert.deepEqual(size(subject.read()), before);
  });
}
