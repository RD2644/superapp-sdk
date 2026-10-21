/*!
 * Copyright (c) Grab Taxi Holdings PTE LTD (GRAB)
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasResult, isError } from '../../core/guards';
import { NetworkModule } from './NetworkModule';
import { NetworkTelemetryEvent, SendResponse } from './types';

describe('NetworkModule', () => {
  describe('send', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      delete (window as unknown as Record<string, unknown>).WrappedNetworkModule;
    });

    it('should return 501 when not running in Grab app', async () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124',
      });

      const module = new NetworkModule();
      const response = await module.send({
        endpoint: 'https://api.example.com/users',
        method: 'GET',
      });

      expect(response.status_code).toBe(501);
      if (isError(response)) {
        expect(response.error).toBe(
          'Not implemented: This method requires the Grab app environment'
        );
      }
    });

    it('should return 200 with response data on successful GET request', async () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Grab/5.399.0 (Android 13; SM-G998B)',
      });

      const mockResponse: SendResponse = {
        status_code: 200,
        result: { id: 123, name: 'John Doe' },
      };

      const mockInvoke = vi.fn().mockResolvedValue(mockResponse);

      (window as unknown as Record<string, { invoke: typeof mockInvoke }>).WrappedNetworkModule = {
        invoke: mockInvoke,
      };

      const module = new NetworkModule();
      const response = await module.send({
        endpoint: 'https://api.example.com/users',
        method: 'GET',
      });

      expect(mockInvoke).toHaveBeenCalledWith('send', {
        endpoint: 'https://api.example.com/users',
        method: 'GET',
      });
      expect(response.status_code).toBe(200);
      if (hasResult(response)) {
        expect(response.result).toEqual({ id: 123, name: 'John Doe' });
      }
    });

    it('should return 200 with response data on successful POST request', async () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Grab/5.399.0 (iPhone; iOS 16.0)',
      });

      const mockResponse: SendResponse = {
        status_code: 200,
        result: { id: 456, created: true },
      };

      const mockInvoke = vi.fn().mockResolvedValue(mockResponse);

      (window as unknown as Record<string, { invoke: typeof mockInvoke }>).WrappedNetworkModule = {
        invoke: mockInvoke,
      };

      const module = new NetworkModule();
      const response = await module.send({
        endpoint: 'https://api.example.com/users',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Jane Doe' },
        timeout: 30,
      });

      expect(mockInvoke).toHaveBeenCalledWith('send', {
        endpoint: 'https://api.example.com/users',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Jane Doe' },
        timeout: 30,
      });
      expect(response.status_code).toBe(200);
      if (hasResult(response)) {
        expect(response.result).toEqual({ id: 456, created: true });
      }
    });

    it('should parse stringified JSON result from JSBridge', async () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Grab/5.399.0 (Android 13; SM-G998B)',
      });

      const mockResponse: SendResponse = {
        status_code: 200,
        result: '{"id": 789, "name": "String User"}' as unknown as Record<string, unknown>,
      };

      const mockInvoke = vi.fn().mockResolvedValue(mockResponse);

      (window as unknown as Record<string, { invoke: typeof mockInvoke }>).WrappedNetworkModule = {
        invoke: mockInvoke,
      };

      const module = new NetworkModule();
      const response = await module.send({
        endpoint: 'https://api.example.com/users/789',
        method: 'GET',
      });

      expect(mockInvoke).toHaveBeenCalledWith('send', {
        endpoint: 'https://api.example.com/users/789',
        method: 'GET',
      });
      expect(response.status_code).toBe(200);
      if (hasResult(response)) {
        expect(response.result).toEqual({ id: 789, name: 'String User' });
      }
    });

    it('should return 500 when result is invalid JSON string', async () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Grab/5.399.0 (iPhone; iOS 16.0)',
      });

      const mockResponse: SendResponse = {
        status_code: 200,
        result: 'invalid json string' as unknown as Record<string, unknown>,
      };

      const mockInvoke = vi.fn().mockResolvedValue(mockResponse);

      (window as unknown as Record<string, { invoke: typeof mockInvoke }>).WrappedNetworkModule = {
        invoke: mockInvoke,
      };

      const module = new NetworkModule();
      const response = await module.send({
        endpoint: 'https://api.example.com/users',
        method: 'GET',
      });

      expect(mockInvoke).toHaveBeenCalledWith('send', {
        endpoint: 'https://api.example.com/users',
        method: 'GET',
      });
      expect(response.status_code).toBe(500);
      if (isError(response)) {
        expect(response.error).toBe('Failed to parse response result as JSON');
      }
    });

    it('should return 500 when network request fails', async () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Grab/5.399.0 (Android 13; SM-G998B)',
      });

      const mockResponse: SendResponse = {
        status_code: 500,
        error: 'Network request failed',
      };

      const mockInvoke = vi.fn().mockResolvedValue(mockResponse);

      (window as unknown as Record<string, { invoke: typeof mockInvoke }>).WrappedNetworkModule = {
        invoke: mockInvoke,
      };

      const module = new NetworkModule();
      const response = await module.send(
        {
          endpoint: 'https://api.example.com/users',
          method: 'GET',
        },
        { retry: false }
      );

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledWith('send', {
        endpoint: 'https://api.example.com/users',
        method: 'GET',
      });
      expect(response.status_code).toBe(500);
      if (isError(response)) {
        expect(response.error).toBe('Network request failed');
      }
    });

    it('should return 500 when an unexpected error occurs during invoke', async () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Grab/5.399.0 (iPhone; iOS 16.0)',
      });

      const mockInvoke = vi.fn().mockImplementation(() => {
        throw new Error('Unexpected bridge error');
      });

      (window as unknown as Record<string, { invoke: typeof mockInvoke }>).WrappedNetworkModule = {
        invoke: mockInvoke,
      };

      const module = new NetworkModule();
      const response = await module.send(
        {
          endpoint: 'https://api.example.com/users',
          method: 'GET',
        },
        { retry: false }
      );

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledWith('send', {
        endpoint: 'https://api.example.com/users',
        method: 'GET',
      });
      expect(response.status_code).toBe(500);
      if (isError(response)) {
        expect(response.error).toBe('Failed to invoke method: Unexpected bridge error');
      }
    });
  });

  describe('send retries and telemetry', () => {
    const GRAB_UA = 'Grab/5.399.0 (Android 13; SM-G998B)';
    const OK_RESPONSE: SendResponse = { status_code: 200, result: { ok: true } };
    const noJitter = { jitter: false };

    const partnerError = (statusCode: number): SendResponse =>
      ({ status_code: statusCode, error: `Partner error ${statusCode}` }) as SendResponse;

    const mockBridge = (...responses: unknown[]): ReturnType<typeof vi.fn> => {
      const mockInvoke = vi.fn();
      responses.forEach((response) => {
        if (response instanceof Error) {
          mockInvoke.mockImplementationOnce(() => {
            throw response;
          });
        } else {
          mockInvoke.mockResolvedValueOnce(response);
        }
      });
      (window as unknown as Record<string, { invoke: typeof mockInvoke }>).WrappedNetworkModule = {
        invoke: mockInvoke,
      };
      return mockInvoke;
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal('navigator', { userAgent: GRAB_UA });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      delete (window as unknown as Record<string, unknown>).WrappedNetworkModule;
    });

    it.each([500, 502, 503, 504])(
      'should retry a %i partner error and return the eventual success',
      async (statusCode) => {
        const mockInvoke = mockBridge(
          partnerError(statusCode),
          partnerError(statusCode),
          OK_RESPONSE
        );

        const module = new NetworkModule({ retry: noJitter });
        const promise = module.send({
          endpoint: 'https://partner.example.com/checkout',
          method: 'GET',
        });
        await vi.runAllTimersAsync();
        const response = await promise;

        expect(mockInvoke).toHaveBeenCalledTimes(3);
        expect(response).toEqual(OK_RESPONSE);
      }
    );

    it.each([500, 502, 503, 504])(
      'should return the last %i partner error and warn once retries are exhausted',
      async (statusCode) => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const mockInvoke = mockBridge(
          partnerError(statusCode),
          partnerError(statusCode),
          partnerError(statusCode)
        );

        const module = new NetworkModule({ retry: noJitter });
        const promise = module.send(
          { endpoint: 'https://partner.example.com/checkout?token=secret', method: 'GET' },
          { requestId: 'req-1' }
        );
        await vi.runAllTimersAsync();
        const response = await promise;

        expect(mockInvoke).toHaveBeenCalledTimes(3);
        expect(response).toEqual(partnerError(statusCode));
        expect(warnSpy).toHaveBeenCalledWith(
          `[SuperAppSDK][NetworkModule.send] GET https://partner.example.com/checkout failed with ${statusCode} after 3 attempt(s) (requestId: req-1): Partner error ${statusCode}`
        );
      }
    );

    it('should retry when the bridge call throws', async () => {
      const mockInvoke = mockBridge(new Error('Bridge timeout'), OK_RESPONSE);

      const module = new NetworkModule({ retry: noJitter });
      const promise = module.send({
        endpoint: 'https://partner.example.com/checkout',
        method: 'GET',
      });
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(response).toEqual(OK_RESPONSE);
    });

    it('should wait with exponential backoff between attempts', async () => {
      const mockInvoke = mockBridge(
        partnerError(503),
        partnerError(503),
        partnerError(503),
        OK_RESPONSE
      );

      const module = new NetworkModule({
        retry: { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 10_000, jitter: false },
      });
      const promise = module.send({
        endpoint: 'https://partner.example.com/checkout',
        method: 'GET',
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(99);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockInvoke).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(199);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockInvoke).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(399);
      expect(mockInvoke).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockInvoke).toHaveBeenCalledTimes(4);

      await expect(promise).resolves.toEqual(OK_RESPONSE);
    });

    it('should cap backoff delays at maxDelayMs', async () => {
      const events: NetworkTelemetryEvent[] = [];
      mockBridge(partnerError(502), partnerError(502), partnerError(502), partnerError(502));

      const module = new NetworkModule({
        retry: { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 250, jitter: false },
        onTelemetry: (event) => events.push(event),
      });
      const promise = module.send({
        endpoint: 'https://partner.example.com/checkout',
        method: 'GET',
      });
      await vi.runAllTimersAsync();
      await promise;

      const delays = events.flatMap((event) =>
        event.type === 'attempt_end' && event.retryDelayMs !== undefined ? [event.retryDelayMs] : []
      );
      expect(delays).toEqual([100, 200, 250]);
    });

    it('should apply full jitter to delays by default', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const events: NetworkTelemetryEvent[] = [];
      mockBridge(partnerError(503), OK_RESPONSE);

      const module = new NetworkModule({ onTelemetry: (event) => events.push(event) });
      const promise = module.send({
        endpoint: 'https://partner.example.com/checkout',
        method: 'GET',
      });
      await vi.runAllTimersAsync();
      await promise;

      expect(events.find((event) => event.type === 'attempt_end')).toMatchObject({
        retryDelayMs: 100,
      });
    });

    it.each([
      { description: '400', response: { status_code: 400, error: 'Bad request' } },
      { description: '401', response: { status_code: 401, error: 'Unauthorized' } },
      { description: '404', response: { status_code: 404, error: 'Not found' } },
      { description: '501', response: { status_code: 501, error: 'Not implemented' } },
    ])('should not retry a $description response', async ({ response }) => {
      const mockInvoke = mockBridge(response, OK_RESPONSE);

      const module = new NetworkModule({ retry: noJitter });
      const promise = module.send({
        endpoint: 'https://partner.example.com/checkout',
        method: 'GET',
      });
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toEqual(response);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('should not retry when not running in the Grab app', async () => {
      vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/91.0.4472.124' });
      const mockInvoke = mockBridge(OK_RESPONSE);

      const module = new NetworkModule({ retry: noJitter });
      const promise = module.send({
        endpoint: 'https://partner.example.com/checkout',
        method: 'GET',
      });
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toMatchObject({ status_code: 501 });
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should not retry a JSON parse failure', async () => {
      const mockInvoke = mockBridge({ status_code: 200, result: 'not json' }, OK_RESPONSE);

      const module = new NetworkModule({ retry: noJitter });
      const promise = module.send({
        endpoint: 'https://partner.example.com/checkout',
        method: 'GET',
      });
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toEqual({
        status_code: 500,
        error: 'Failed to parse response result as JSON',
      });
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it.each(['POST', 'PATCH'] as const)(
      'should not retry %s requests by default',
      async (method) => {
        const mockInvoke = mockBridge(partnerError(503), OK_RESPONSE);

        const module = new NetworkModule({ retry: noJitter });
        const promise = module.send({ endpoint: 'https://partner.example.com/checkout', method });
        await vi.runAllTimersAsync();

        await expect(promise).resolves.toEqual(partnerError(503));
        expect(mockInvoke).toHaveBeenCalledTimes(1);
      }
    );

    it('should retry POST requests when opted in via retryableMethods', async () => {
      const mockInvoke = mockBridge(partnerError(503), OK_RESPONSE);

      const module = new NetworkModule({ retry: noJitter });
      const promise = module.send(
        {
          endpoint: 'https://partner.example.com/checkout',
          method: 'POST',
          headers: { 'Idempotency-Key': 'abc' },
        },
        { retry: { retryableMethods: ['POST'] } }
      );
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toEqual(OK_RESPONSE);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it('should disable retries per request with retry: false', async () => {
      const mockInvoke = mockBridge(partnerError(503), OK_RESPONSE);

      const module = new NetworkModule({ retry: noJitter });
      const promise = module.send(
        { endpoint: 'https://partner.example.com/checkout', method: 'GET' },
        { retry: false }
      );
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toEqual(partnerError(503));
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('should let a per-request policy re-enable retries disabled on the module', async () => {
      const mockInvoke = mockBridge(partnerError(503), partnerError(503), OK_RESPONSE);

      const module = new NetworkModule({ retry: false });
      const promise = module.send(
        { endpoint: 'https://partner.example.com/checkout', method: 'GET' },
        { retry: { maxAttempts: 3, jitter: false } }
      );
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toEqual(OK_RESPONSE);
      expect(mockInvoke).toHaveBeenCalledTimes(3);
    });

    it('should emit structured telemetry for each attempt and the final outcome', async () => {
      const events: NetworkTelemetryEvent[] = [];
      mockBridge(partnerError(503), OK_RESPONSE);

      const module = new NetworkModule({
        retry: noJitter,
        onTelemetry: (event) => events.push(event),
      });
      const promise = module.send(
        {
          endpoint: 'https://partner.example.com/checkout?session=secret#step',
          method: 'PUT',
          headers: { Authorization: 'Bearer secret' },
          body: { card: 'secret' },
        },
        { requestId: 'checkout-42' }
      );
      await vi.advanceTimersByTimeAsync(50);
      await vi.runAllTimersAsync();
      await promise;

      const base = {
        requestId: 'checkout-42',
        method: 'PUT',
        endpoint: 'https://partner.example.com/checkout',
        maxAttempts: 3,
      };
      expect(events).toEqual([
        { ...base, type: 'attempt_start', attempt: 1 },
        {
          ...base,
          type: 'attempt_end',
          attempt: 1,
          statusCode: 503,
          durationMs: 0,
          error: 'Partner error 503',
          retryDelayMs: 200,
        },
        { ...base, type: 'attempt_start', attempt: 2 },
        { ...base, type: 'attempt_end', attempt: 2, statusCode: 200, durationMs: 0 },
        {
          ...base,
          type: 'request_end',
          attempt: 2,
          statusCode: 200,
          durationMs: 200,
          retriesExhausted: false,
        },
      ]);
      expect(JSON.stringify(events)).not.toContain('secret');
    });

    it('should report exhausted retries in the request_end event', async () => {
      const events: NetworkTelemetryEvent[] = [];
      mockBridge(partnerError(504), partnerError(504));

      const module = new NetworkModule({
        retry: { maxAttempts: 2, jitter: false },
        onTelemetry: (event) => events.push(event),
      });
      const promise = module.send({
        endpoint: 'https://partner.example.com/checkout',
        method: 'GET',
      });
      await vi.runAllTimersAsync();
      await promise;

      expect(events[events.length - 1]).toMatchObject({
        type: 'request_end',
        attempt: 2,
        maxAttempts: 2,
        statusCode: 504,
        error: 'Partner error 504',
        retriesExhausted: true,
      });
    });

    it('should generate a requestId shared by all events when none is provided', async () => {
      const events: NetworkTelemetryEvent[] = [];
      mockBridge(partnerError(500), OK_RESPONSE);

      const module = new NetworkModule({
        retry: noJitter,
        onTelemetry: (event) => events.push(event),
      });
      const promise = module.send({
        endpoint: 'https://partner.example.com/checkout',
        method: 'GET',
      });
      await vi.runAllTimersAsync();
      await promise;

      const requestIds = new Set(events.map((event) => event.requestId));
      expect(requestIds.size).toBe(1);
      expect([...requestIds][0]).toMatch(/^[A-Za-z0-9]{16}$/);
    });

    it('should not emit telemetry for requests that fail validation', async () => {
      const onTelemetry = vi.fn();
      const mockInvoke = mockBridge(OK_RESPONSE);

      const module = new NetworkModule({ onTelemetry });
      const response = await module.send({ endpoint: 123 } as unknown as Parameters<
        NetworkModule['send']
      >[0]);

      expect(response.status_code).toBe(400);
      expect(onTelemetry).not.toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should isolate the request from telemetry hook failures', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockBridge(partnerError(503), OK_RESPONSE);

      const module = new NetworkModule({
        retry: noJitter,
        onTelemetry: () => {
          throw new Error('Analytics down');
        },
      });
      const promise = module.send({
        endpoint: 'https://partner.example.com/checkout',
        method: 'GET',
      });
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toEqual(OK_RESPONSE);
      expect(warnSpy).toHaveBeenCalledWith(
        '[SuperAppSDK][NetworkModule.send] Telemetry hook threw: Analytics down'
      );
    });
  });
});
