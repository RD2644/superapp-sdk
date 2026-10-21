/*!
 * Copyright (c) Grab Taxi Holdings PTE LTD (GRAB)
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */

/**
 * Options for computing an exponential backoff delay.
 *
 * @internal
 */
export type BackoffOptions = {
  /** Delay before the first retry, in milliseconds. */
  baseDelayMs: number;
  /** Upper bound for any single delay, in milliseconds. */
  maxDelayMs: number;
  /** Whether to apply full jitter to the delay. */
  jitter: boolean;
};
