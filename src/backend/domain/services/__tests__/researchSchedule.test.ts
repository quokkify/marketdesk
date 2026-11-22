import { nextAutoAt } from '../researchSchedule';

const HOUR_MS = 60 * 60 * 1000;
const FINISHED = new Date('2026-11-22T12:00:00.000Z');

function hoursAfterFinish(date: Date): number {
  return (date.getTime() - FINISHED.getTime()) / HOUR_MS;
}

describe('nextAutoAt', () => {
  it('waits 7 days after an ok run', () => {
    expect(hoursAfterFinish(nextAutoAt('ok', 0, FINISHED))).toBe(7 * 24);
  });

  it('waits 24 hours after a partial run', () => {
    expect(hoursAfterFinish(nextAutoAt('partial', 0, FINISHED))).toBe(24);
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [6, 24],
  ])('waits after %i consecutive failed runs %i hours, doubling up to a 24 hour cap', (failures, hours) => {
    expect(hoursAfterFinish(nextAutoAt('failed', failures, FINISHED))).toBe(hours);
  });

  it('treats a failed run without a counted failure as the first one', () => {
    expect(hoursAfterFinish(nextAutoAt('failed', 0, FINISHED))).toBe(1);
  });
});
