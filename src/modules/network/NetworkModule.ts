/*!
 * Copyright (c) Grab Taxi Holdings PTE LTD (GRAB)
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */

import { BaseModule, hasResult, isSuccess } from '../../core';
import { generateRandomString } from '../../utils/crypto';
import { isErrorWithMessage } from '../../utils/error';
import { computeBackoffDelay, sleep } from '../../utils/retry';
import { RawSendResponseSchema, SendRequestSchema, SendResponseSchema } from './schemas';
import {
  NetworkModuleOptions,
  NetworkRetryOptions,
  NetworkTelemetryEvent,
  RawSendResponse,
  SendMethod,
  SendOptions,
  SendRequest,
  SendResponse,
} from './types';

type ResolvedRetryPolicy = Required<NetworkRetryOptions>;

const DEFAULT_RETRY_POLICY: ResolvedRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2000,
  jitter: true,
  retryableMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
};

const isRetryableStatus = (statusCode: number): boolean => statusCode >= 500 && statusCode !== 501;

const stripQueryAndFragment = (endpoint: string): string => endpoint.split(/[?#]/)[0];

const getErrorMessage = (response: { status_code: number }): string | undefined =>
  'error' in response && typeof response.error === 'string' ? response.error : undefined;

/**
 * SDK module for making network requests through the native layer via `JSBridge`.
 *
 * @group Modules
 * @category Network
 *
 * @remarks
 * Provides access to native network functionality for making HTTP requests.
 * This module is **only** for MiniApps hosted on the Grab domain to call authenticated Grab API endpoints.
 * It should **not** be used by external MiniApps (not on Grab domain) or for non-authenticated Grab APIs.
 * This code must run on the Grab SuperApp's WebView to function correctly.
 *
 * @example
 * **ES Module:**
 * ```typescript
 * import { NetworkModule } from '@grabjs/superapp-sdk';
 * const networkModule = new NetworkModule();
 * ```
 *
 * @example
 * **CDN (UMD):**
 * ```html
 * <script src="https://cdn.jsdelivr.net/npm/@grabjs/superapp-sdk@x.y.z/dist/index.js"></script>
 * <script>
 *   const networkModule = new SuperAppSDK.NetworkModule();
 * </script>
 * ```
 *
 * @example
 * **Retries and telemetry:**
 * ```typescript
 * const networkModule = new NetworkModule({
 *   retry: { maxAttempts: 4, baseDelayMs: 250 },
 *   onTelemetry: (event) => analytics.track(`network_${event.type}`, event),
 * });
 * ```
 *
 * @public
 * @noInheritDoc
 */
export class NetworkModule extends BaseModule {
  private readonly options: NetworkModuleOptions;

  /**
   * Creates a network module.
   *
   * @param options - Default retry policy and telemetry hook. See {@link NetworkModuleOptions}.
   */
  constructor(options?: NetworkModuleOptions) {
    super('NetworkModule');
    this.options = options ?? {};
  }

  /**
   * Sends a network request through `JSBridge`.
   *
   * @remarks
   * Server errors (`5xx` other than `501`) and `JSBridge` failures are retried with exponential backoff
   * for idempotent methods (`GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`), up to 3 attempts by default.
   * `POST` and `PATCH` are only retried when listed in {@link NetworkRetryOptions.retryableMethods}.
   * Each attempt and the final outcome are reported to the `onTelemetry` hook, if configured.
   * A final retryable failure is also logged with `console.warn`.
   *
   * @param request - Network request parameters.
   * @param options - Per-request retry policy and telemetry request ID. See {@link SendOptions}.
   *
   * @returns The network response containing the result data or error information. See {@link SendResponse}.
   *
   * @example
   * ```typescript
   * import { NetworkModule, isSuccess, isError, hasResult } from '@grabjs/superapp-sdk';
   *
   * // Initialize the network module
   * const network = new NetworkModule();
   *
   * // Send a POST request with headers and body
   * const response = await network.send({
   *   endpoint: 'https://api.example.com/users',
   *   method: 'POST',
   *   headers: { 'Content-Type': 'application/json' },
   *   body: { name: 'John', email: 'john@example.com' },
   *   timeout: 30
   * });
   *
   * // Handle the response
   * if (isSuccess(response) && hasResult(response)) {
   *   console.log('Success:', response.result);
   * } else if (isError(response)) {
   *   console.error(`Error ${response.status_code}: ${response.error}`);
   * } else {
   *   console.error('Unhandled response');
   * }
   * ```
   *
   * @public
   */
  async send(request: SendRequest, options?: SendOptions): Promise<SendResponse> {
    const requestError = this.validate(SendRequestSchema, request);
    if (requestError) return { status_code: 400, error: requestError };

    const policy = this.resolveRetryPolicy(request.method, options?.retry);
    const baseEvent = {
      requestId: options?.requestId ?? generateRandomString(16),
      method: request.method,
      endpoint: stripQueryAndFragment(request.endpoint),
      maxAttempts: policy.maxAttempts,
    };
    const requestStartedAt = Date.now();

    for (let attempt = 1; ; attempt += 1) {
      this.emitTelemetry({ ...baseEvent, type: 'attempt_start', attempt });

      const attemptStartedAt = Date.now();
      const { response, retryable } = await this.sendOnce(request);
      const error = getErrorMessage(response);
      const willRetry = retryable && attempt < policy.maxAttempts;
      const retryDelayMs = willRetry ? computeBackoffDelay(attempt, policy) : undefined;

      this.emitTelemetry({
        ...baseEvent,
        type: 'attempt_end',
        attempt,
        statusCode: response.status_code,
        durationMs: Date.now() - attemptStartedAt,
        ...(error !== undefined && { error }),
        ...(retryDelayMs !== undefined && { retryDelayMs }),
      });

      if (retryDelayMs === undefined) {
        if (retryable) {
          this.logger.warn(
            'send',
            `${request.method} ${baseEvent.endpoint} failed with ${response.status_code} after ${attempt} attempt(s) (requestId: ${baseEvent.requestId})${error ? `: ${error}` : ''}`
          );
        }

        this.emitTelemetry({
          ...baseEvent,
          type: 'request_end',
          attempt,
          statusCode: response.status_code,
          durationMs: Date.now() - requestStartedAt,
          ...(error !== undefined && { error }),
          retriesExhausted: retryable && policy.maxAttempts > 1,
        });

        return response;
      }

      await sleep(retryDelayMs);
    }
  }

  /**
   * Resolves the retry policy for a request from the defaults, module options and per-request options.
   *
   * @returns The effective retry policy. `maxAttempts` is `1` when the method is not retryable.
   *
   * @private
   */
  private resolveRetryPolicy(
    method: SendMethod,
    override: SendOptions['retry']
  ): ResolvedRetryPolicy {
    const moduleRetry = this.options.retry;
    if (override === false || (override === undefined && moduleRetry === false)) {
      return { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 };
    }

    const layers = [moduleRetry || {}, override || {}];
    const pick = <K extends keyof NetworkRetryOptions>(key: K): ResolvedRetryPolicy[K] =>
      layers.reduce<ResolvedRetryPolicy[K]>(
        (value, layer) => (layer[key] ?? value) as ResolvedRetryPolicy[K],
        DEFAULT_RETRY_POLICY[key]
      );

    const maxAttempts = pick('maxAttempts');
    const retryableMethods = pick('retryableMethods');

    return {
      maxAttempts:
        Number.isFinite(maxAttempts) && retryableMethods.includes(method)
          ? Math.max(1, Math.floor(maxAttempts))
          : 1,
      baseDelayMs: Math.max(0, pick('baseDelayMs')),
      maxDelayMs: Math.max(0, pick('maxDelayMs')),
      jitter: pick('jitter'),
      retryableMethods,
    };
  }

  /**
   * Forwards a telemetry event to the configured hook, isolating the request from hook failures.
   *
   * @private
   */
  private emitTelemetry(event: NetworkTelemetryEvent): void {
    const { onTelemetry } = this.options;
    if (!onTelemetry) return;

    try {
      onTelemetry(event);
    } catch (error) {
      this.logger.warn(
        'send',
        `Telemetry hook threw: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Performs a single `JSBridge` call and normalizes its response.
   *
   * @returns The normalized response, and whether the failure can be retried.
   *
   * @private
   */
  private async sendOnce(
    request: SendRequest
  ): Promise<{ response: SendResponse; retryable: boolean }> {
    const rawResponse = (await this.invoke({
      method: 'send',
      params: request,
    })) as RawSendResponse;

    const rawResponseError = this.validate(RawSendResponseSchema, rawResponse);
    if (rawResponseError) {
      this.logger.warn('send', `Unexpected raw response shape: ${rawResponseError}`);
    }

    // `JSBridge` may return response bodies as JSON strings
    // Parse string results into objects for consistency.
    // If parsing fails, return a 500 error rather than exposing invalid data.
    if (
      isSuccess(rawResponse) &&
      hasResult(rawResponse) &&
      typeof rawResponse.result === 'string'
    ) {
      try {
        const parsedResult = JSON.parse(rawResponse.result) as Record<string, unknown>;
        const response: SendResponse = {
          ...rawResponse,
          result: parsedResult,
        };

        const responseError = this.validate(SendResponseSchema, response);
        if (responseError) {
          this.logger.warn('send', `Unexpected response shape after parsing: ${responseError}`);
        }

        return { response, retryable: false };
      } catch {
        return {
          response: {
            status_code: 500,
            error: 'Failed to parse response result as JSON',
          },
          retryable: false,
        };
      }
    }

    const response = rawResponse as SendResponse;

    const responseError = this.validate(SendResponseSchema, response);
    if (responseError) {
      this.logger.warn('send', `Unexpected response shape: ${responseError}`);
    }

    return { response, retryable: isRetryableStatus(response.status_code) };
  }
}
