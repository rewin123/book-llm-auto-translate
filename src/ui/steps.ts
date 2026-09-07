import type { JobPhase } from '../job/types.ts';

export type Step =
  | 'book'
  | 'settings'
  | 'brief'
  | 'verify'
  | 'glossary'
  | 'run'
  | 'translateReview';

export type PausedDuring = 'style' | 'glossary' | 'translate' | 'verify' | 'translateReview' | null;

/** Maps the runner phase onto the numbered pipeline stepper. */
export function stepForPhase(
  phase: JobPhase,
  idle: { setupStep: 'book' | 'settings'; hasBook: boolean },
  pausedDuring: PausedDuring = null,
): Step {
  if (phase === 'idle') {
    return idle.setupStep === 'settings' && idle.hasBook ? 'settings' : 'book';
  }
  if (phase === 'style' || phase === 'review') return 'brief';
  if (phase === 'verify' || phase === 'verifyReview') return 'verify';
  if (phase === 'glossary' || phase === 'glossaryReview') return 'glossary';
  if (
    phase === 'translateReview' ||
    phase === 'done' ||
    ((phase === 'paused' || phase === 'error') && pausedDuring === 'translateReview')
  ) {
    return 'translateReview';
  }
  return 'run';
}
