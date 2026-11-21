import { reactivationOutcome } from './ListingReactivationService';

describe('reactivationOutcome', () => {
  it.each([
    ['active', 'live'],
    ['new', 'pending_moderation'],
    // OLX lists a disabled advert under "Oczekujące" (waiting for verification) right after activate.
    ['disabled', 'pending_moderation'],
    ['limited', 'limited'],
    ['moderated', 'unchanged'],
    [null, 'unchanged'],
  ])('maps OLX status %p to %s', (remoteStatus, expected) => {
    expect(reactivationOutcome(remoteStatus)).toBe(expected);
  });
});
