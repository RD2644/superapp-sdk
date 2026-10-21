/*!
 * Copyright (c) Grab Taxi Holdings PTE LTD (GRAB)
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */

import type { SDKErrorResponse, SDKNoContentResponse, SDKOkResponse } from '../../core';

/**
 * Request parameters for sending a network request.
 *
 * @group Modules
 * @category Network
 *
 * @public
 */
export type SendRequest = {
  /** Request payload body. */
  body?: unknown;
  /** Request endpoint URL. */
  endpoint: string;
  /** HTTP headers sent with the request. */
  headers?: Record<string, string>;
  /** HTTP method used for the request (for example, `"GET"` or `"POST"`). */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  /** Query parameters appended to the request URL. */
  query?: Record<string, string>;
  /** Request timeout in milliseconds. */
  timeout?: number;
};

/**
 * Result object containing the network response data.
 *
 * @group Modules
 * @category Network
 *
 * @remarks
 * The result type is `Record<string, unknown>` as response bodies are always
 * returned as objects. String responses from `JSBridge` are automatically
 * parsed to JSON.
 *
 * @public
 */
export type SendResult = Record<string, unknown>;

/**
 * Response when sending a network request.
 *
 * @group Modules
 * @category Network
 *
 * @public
 */
export type SendResponse =
  | SDKOkResponse<SendResult>
  | SDKNoContentResponse
  | SDKErrorResponse<400>
  | SDKErrorResponse<401>
  | SDKErrorResponse<403>
  | SDKErrorResponse<404>
  | SDKErrorResponse<424>
  | SDKErrorResponse<426>
  | SDKErrorResponse<500>
  | SDKErrorResponse<501>;

/**
 * Internal type for the raw `JSBridge` response result.
 * `JSBridge` may return either a JSON string or a parsed Record.
 *
 * @internal
 */
export type RawSendResult = string | SendResult;

/**
 * Internal type for the raw `JSBridge` response before transformation.
 * Used internally to handle the `JSBridge` response format.
 *
 * @internal
 */
export type RawSendResponse =
  | SDKOkResponse<RawSendResult>
  | SDKNoContentResponse
  | SDKErrorResponse<400>
  | SDKErrorResponse<401>
  | SDKErrorResponse<403>
  | SDKErrorResponse<404>
  | SDKErrorResponse<424>
  | SDKErrorResponse<426>
  | SDKErrorResponse<500>
  | SDKErrorResponse<501>;

/**
 * HTTP method accepted by {@link SendRequest}.
 *
 * @group Modules
 * @category Network
 *
 * @public
 */
export type SendMethod = SendRequest['method'];

/**
 * Retry policy for {@link NetworkModule.send}.
 *
 * @group Modules
 * @category Network
 *
 * @remarks
 * A response is retried when its `status_code` is a server error (`5xx`) other than `501`,
 * or when the `JSBridge` call throws. `501` (not running in the Grab app) and client errors (`4xx`) are never retried.
 * Delays grow exponentially: `baseDelayMs * 2^(attempt - 1)`, capped at `maxDelayMs`.
 *
 * @public
 */
export type NetworkRetryOptions = {
  /** Maximum number of attempts, including the first one. Set to `1` to disable retries. Defaults to `3`. */
  maxAttempts?: number;
  /** Delay before the first retry, in milliseconds. Defaults to `200`. */
  baseDelayMs?: number;
  /** Upper bound for any single delay, in milliseconds. Defaults to `2000`. */
  maxDelayMs?: number;
  /** Whether to randomize each delay between `0` and the computed value ("full jitter"). Defaults to `true`. */
  jitter?: boolean;
  /**
   * HTTP methods that may be retried.
   * Defaults to the idempotent methods `GET`, `HEAD`, `OPTIONS`, `PUT` and `DELETE`.
   * Only add `POST` or `PATCH` when the endpoint is idempotent (for example, it deduplicates on an idempotency key).
   */
  retryableMethods?: SendMethod[];
};

/**
 * Fields shared by every {@link NetworkTelemetryEvent}.
 *
 * @group Modules
 * @category Network
 *
 * @remarks
 * Request headers, body and query parameters are never included, to avoid leaking credentials or personal data.
 *
 * @public
 */
export type NetworkTelemetryEventBase = {
  /** Identifier shared by every event of one {@link NetworkModule.send} call. */
  requestId: string;
  /** HTTP method of the request. */
  method: SendMethod;
  /** Request endpoint without its query string or fragment. */
  endpoint: string;
  /** 1-based attempt number. For `request_end`, the total number of attempts made. */
  attempt: number;
  /** Maximum number of attempts allowed for this request. */
  maxAttempts: number;
};

/**
 * Structured telemetry event emitted by {@link NetworkModule.send}.
 *
 * @group Modules
 * @category Network
 *
 * @remarks
 * - `attempt_start`: emitted before each `JSBridge` call.
 * - `attempt_end`: emitted after each `JSBridge` call. `retryDelayMs` is set when another attempt will follow.
 * - `request_end`: emitted once with the final outcome, after all attempts.
 *
 * @public
 */
export type NetworkTelemetryEvent =
  | (NetworkTelemetryEventBase & { type: 'attempt_start' })
  | (NetworkTelemetryEventBase & {
      type: 'attempt_end';
      /** Status code returned by this attempt. */
      statusCode: number;
      /** Duration of this attempt, in milliseconds. */
      durationMs: number;
      /** Error message, when the attempt failed. */
      error?: string;
      /** Delay before the next attempt, in milliseconds. Absent when no retry follows. */
      retryDelayMs?: number;
    })
  | (NetworkTelemetryEventBase & {
      type: 'request_end';
      /** Final status code returned to the caller. */
      statusCode: number;
      /** Total duration across all attempts and delays, in milliseconds. */
      durationMs: number;
      /** Final error message, when the request failed. */
      error?: string;
      /** `true` when the request failed with a retryable error after using every attempt. */
      retriesExhausted: boolean;
    });

/**
 * Callback receiving {@link NetworkTelemetryEvent}s.
 *
 * @group Modules
 * @category Network
 *
 * @remarks
 * Errors thrown by the hook are caught and logged, and never affect the request.
 *
 * @public
 */
export type NetworkTelemetryHook = (event: NetworkTelemetryEvent) => void;

/**
 * Options for constructing a {@link NetworkModule}.
 *
 * @group Modules
 * @category Network
 *
 * @public
 */
export type NetworkModuleOptions = {
  /** Default retry policy for every request. Pass `false` to disable retries. */
  retry?: NetworkRetryOptions | false;
  /** Hook receiving structured telemetry for every request. */
  onTelemetry?: NetworkTelemetryHook;
};

/**
 * Per-request options for {@link NetworkModule.send}.
 *
 * @group Modules
 * @category Network
 *
 * @public
 */
export type SendOptions = {
  /** Retry policy for this request, merged over the module default. Pass `false` to disable retries. */
  retry?: NetworkRetryOptions | false;
  /** Identifier reported in telemetry events, for correlating with your own logs. Generated when omitted. */
  requestId?: string;
};
