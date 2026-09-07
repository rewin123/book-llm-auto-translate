import { describe, expect, it } from 'vitest';
import { stepForPhase } from '../../src/ui/steps.ts';

const idle = { setupStep: 'book' as const, hasBook: false };

describe('stepForPhase', () => {
  it('keeps translate on its own step while chunks are in flight', () => {
    expect(stepForPhase('translate', idle)).toBe('run');
    expect(stepForPhase('paused', idle, 'translate')).toBe('run');
  });

  it('gives seam review its own stepper stage', () => {
    expect(stepForPhase('translateReview', idle)).toBe('translateReview');
    expect(stepForPhase('paused', idle, 'translateReview')).toBe('translateReview');
    expect(stepForPhase('error', idle, 'translateReview')).toBe('translateReview');
    expect(stepForPhase('done', idle)).toBe('translateReview');
  });

  it('does not treat style-guide review as the seam-review step', () => {
    expect(stepForPhase('review', idle)).toBe('brief');
  });
});
