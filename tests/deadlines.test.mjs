import test from 'node:test';
import assert from 'node:assert/strict';
import deadlines from '../pilot/deadlines.js';
for (const [value, instant] of [
  ['2027-01-18T09:00', '2027-01-18T07:00:00.000Z'],
  ['2027-06-18T09:00', '2027-06-18T06:00:00.000Z'],
  ['2028-02-29T00:00', '2028-02-28T22:00:00.000Z']
]) test('Vilnius round trip '+value, () => {
  assert.equal(deadlines.toInstant(value), instant);
  assert.equal(deadlines.inputValue(instant), value);
});
for (const value of ['', '2027-02-29T09:00','2027-03-28T03:30','2027-10-31T03:30']) {
  test('reject invalid or ambiguous '+value, () => assert.throws(() => deadlines.toInstant(value)));
}
