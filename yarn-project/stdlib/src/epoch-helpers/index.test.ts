import { EpochNumber } from '@aztec/foundation/branded-types';

import {
  type L1RollupConstants,
  computeQuorum,
  getProofSubmissionDeadlineTimestamp,
  getTimestampRangeForEpoch,
} from './index.js';

describe('EpochHelpers', () => {
  let constants: Omit<L1RollupConstants, 'l1StartBlock'>;
  const l1GenesisTime = 1734440000n;

  beforeEach(() => {
    constants = {
      l1GenesisTime: l1GenesisTime,
      epochDuration: 4,
      slotDuration: 24,
      ethereumSlotDuration: 12,
      proofSubmissionEpochs: 1,
      targetCommitteeSize: 48,
      rollupManaLimit: Number.MAX_SAFE_INTEGER,
    };
  });

  it('returns timestamp range for initial epoch', () => {
    const [start, end] = getTimestampRangeForEpoch(EpochNumber.fromBigInt(0n), constants);
    expect(start).toEqual(l1GenesisTime);
    expect(end).toEqual(l1GenesisTime + BigInt(24 * 3 + 12));
  });

  it('returns timestamp range for second epoch', () => {
    const [start, end] = getTimestampRangeForEpoch(EpochNumber.fromBigInt(1n), constants);
    expect(start).toEqual(l1GenesisTime + BigInt(24 * 4));
    expect(end).toEqual(l1GenesisTime + BigInt(24 * 4) + BigInt(24 * 3 + 12));
  });

  it('returns proof submission deadline', () => {
    const deadline = getProofSubmissionDeadlineTimestamp(EpochNumber.fromBigInt(3n), constants);
    expect(deadline).toEqual(l1GenesisTime + BigInt(24 * 4 * 3) + BigInt(24 * 8));
  });

  describe('computeQuorum', () => {
    it('returns 1 for committee size 0', () => {
      expect(computeQuorum(0)).toBe(1);
    });

    it('returns 1 for committee size 1', () => {
      expect(computeQuorum(1)).toBe(1);
    });

    it('returns 2 for committee size 2', () => {
      expect(computeQuorum(2)).toBe(2);
    });

    it('returns 3 for committee size 3', () => {
      expect(computeQuorum(3)).toBe(3);
    });

    it('returns 3 for committee size 4', () => {
      expect(computeQuorum(4)).toBe(3);
    });

    it('returns 33 for committee size 48', () => {
      expect(computeQuorum(48)).toBe(33);
    });
  });
});
