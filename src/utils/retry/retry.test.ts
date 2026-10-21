/*!
 * Copyright (c) Grab Taxi Holdings PTE LTD (GRAB)
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { computeBackoffDelay, sleep } from './retry';

describe('computeBackoffDelay', () => {
  const options = { baseDelayMs: 100, maxDelayMs: 1000, jitter: false };

  it.each([
    { attempt: 1, expected: 100 },
    { attempt: 2, expected: 200 },
    { attempt: 3, expected: 400 },
    { attempt: 4, expected: 800 },
  ])('should double the delay for attempt $attempt', ({ attempt, expected }) => {
    expect(computeBackoffDelay(attempt, options)).toBe(expected);
  });

  it('should cap the delay at maxDelayMs', () => {
    expect(computeBackoffDelay(5, options)).toBe(1000);
    expect(computeBackoffDelay(20, options)).toBe(1000);
  });

  it('should apply full jitter when enabled', () => {
    const jittered = { ...options, jitter: true };
    expect(computeBackoffDelay(3, jittered, () => 0)).toBe(0);
    expect(computeBackoffDelay(3, jittered, () => 0.5)).toBe(200);
    expect(computeBackoffDelay(3, jittered, () => 0.999)).toBe(399);
  });
});

describe('sleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve after the given delay', async () => {
    vi.useFakeTimers();
    const resolved = vi.fn();
    const promise = sleep(500).then(resolved);

    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(resolved).toHaveBeenCalledTimes(1);
  });
});
