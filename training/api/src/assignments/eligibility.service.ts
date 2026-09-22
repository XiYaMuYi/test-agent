import crypto from 'node:crypto';

import { HttpException, HttpStatus } from '@nestjs/common';

export class AssignmentProblem extends HttpException {
  public constructor(code: string, status: HttpStatus, detail: string) {
    super({
      type: `https://errors.shenshou-princess.local/${code}`,
      title: code,
      status,
      code,
      detail,
    }, status);
  }
}

export interface StartEligibilityInput {
  readonly assignmentStatus: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly learnerState: string;
  readonly completedAttempts: number;
  readonly maxAttempts: number;
  readonly activeAttemptId: string | null;
}

/**
 * G1 adapter boundary: a stable UUID is derived from the identity subject until
 * the real account system supplies an internal learner UUID.
 */
export function deriveLearnerId(principalId: string): string {
  const digest = crypto.createHash('sha256').update(`learner:${principalId}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${(Number.parseInt(digest.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}

export class EligibilityService {
  assertStartable(input: StartEligibilityInput, now: Date): void {
    if (input.assignmentStatus !== 'active' || now < input.startsAt || now >= input.endsAt) {
      throw new AssignmentProblem('ASSIGNMENT_NOT_ACTIVE', HttpStatus.CONFLICT, 'The assignment is not currently active.');
    }
    if (input.learnerState === 'blocked' || input.learnerState === 'expired') {
      throw new AssignmentProblem('ASSIGNMENT_NOT_ELIGIBLE', HttpStatus.FORBIDDEN, 'The learner is not eligible for this assignment.');
    }
    if (input.completedAttempts >= input.maxAttempts) {
      throw new AssignmentProblem('ASSIGNMENT_QUOTA_EXHAUSTED', HttpStatus.CONFLICT, 'The assignment quota has been exhausted.');
    }
    if (input.activeAttemptId !== null) {
      throw new AssignmentProblem('ATTEMPT_ALREADY_ACTIVE', HttpStatus.CONFLICT, 'An attempt is already active for this assignment.');
    }
  }
}
