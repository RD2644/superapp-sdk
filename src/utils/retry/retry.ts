/*!
 * Copyright (c) Grab Taxi Holdings PTE LTD (GRAB)
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */

import type { BackoffOptions } from './types';

/**
 * Computes the exponential backoff delay before the next attempt.
 *
 * @remarks
 * The delay is `baseDelayMs * 2^(attempt - 1)`, capped at `maxDelayMs`.
 * With `jitter`, a random delay between `0` and that value is returned ("full jitter")
 * so that many clients retrying at once do not hit the partner at the same moment.
 *
 * @param attempt - The 1-based attempt number that just failed.
 * @param options - Backoff options.
 * @param random - Random number source in `[0, 1)`.
 * @returns The delay in milliseconds.
 *
 * @internal
 */
export function computeBackoffDelay(
  attempt: number,
  options: BackoffOptions,
  random: () => number = Math.random
): number {
  const { baseDelayMs, maxDelayMs, jitter } = options;
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return jitter ? Math.floor(random() * exponential) : exponential;
}

/**
 * Resolves after the given number of milliseconds.
 *
 * @param ms - The delay in milliseconds.
 * @returns A promise resolving after the delay.
 *
 * @internal
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
