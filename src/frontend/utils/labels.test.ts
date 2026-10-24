import { AUTONOMY_DESCRIPTIONS } from './labels';

describe('autonomy level descriptions', () => {
  it('says where full-auto changes are recorded instead of promising a notification', () => {
    expect(AUTONOMY_DESCRIPTIONS.full_auto).toContain(
      'Changes are applied and recorded in the activity feed.',
    );
    expect(Object.values(AUTONOMY_DESCRIPTIONS).join(' ')).not.toMatch(/notif|after the fact/i);
  });
});
