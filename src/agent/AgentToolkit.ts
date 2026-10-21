/*!
 * Copyright (c) Grab Taxi Holdings PTE LTD (GRAB)
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */

import { type GenericSchema, safeParse } from 'valibot';

import { isOk } from '../core';
import { CheckoutModule, type TriggerCheckoutRequest } from '../modules/checkout';
import { type EstimateRewardsRequest, LoyaltyModule } from '../modules/loyalty';
import { ScopeModule } from '../modules/scope';
import { isErrorWithMessage } from '../utils/error';
import { Logger } from '../utils/logger';
import { formatIssues } from '../utils/schema';
import {
  AgentCheckoutSummarySchema,
  AgentEstimateRewardsArgsSchema,
  ESTIMATE_REWARDS_JSON_SCHEMA,
  TRIGGER_CHECKOUT_JSON_SCHEMA,
} from './schemas';
import type {
  AgentCheckoutSummary,
  AgentEstimateRewardsResponse,
  AgentRewardsTotal,
  AgentToolDefinition,
  AgentToolkitOptions,
  AgentToolResponse,
  AgentTriggerCheckoutResponse,
} from './types';

const TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [
  {
    name: 'estimate_rewards',
    description:
      'Estimate the GrabRewards points the signed-in user would earn for the given cart items. ' +
      'Read-only. Amounts are in minor units.',
    inputSchema: ESTIMATE_REWARDS_JSON_SCHEMA,
    requiresUserConfirmation: false,
  },
  {
    name: 'trigger_checkout',
    description:
      'Ask the user to confirm and then pay for the given total with Grab checkout. ' +
      'The user always sees the amount and description and must approve before anything is charged. ' +
      'Returns status_code 204 if the user declines.',
    inputSchema: TRIGGER_CHECKOUT_JSON_SCHEMA,
    requiresUserConfirmation: true,
  },
];

const parse = <T>(schema: GenericSchema<T>, value: unknown): { value: T } | { error: string } => {
  const parsed = safeParse(schema, value);
  return parsed.success ? { value: parsed.output } : { error: formatIssues(parsed.issues) };
};

/**
 * Exposes SDK capabilities as tools that an in-app AI assistant can call.
 *
 * @group Modules
 * @category Agent
 *
 * @remarks
 * Intended for assistants that run inside a MiniApp, on behalf of the signed-in user. It does not
 * call native code itself; it wraps {@link LoyaltyModule} and {@link CheckoutModule} with input
 * validation suited to model-generated arguments, a mandatory user confirmation before checkout,
 * a permission check via {@link ScopeModule}, and a telemetry hook.
 *
 * Tool calls never throw. Like the rest of the SDK, they resolve to a response with a
 * `status_code`, which you can pass back to the model as the tool result.
 *
 * @example
 * ```typescript
 * import { AgentToolkit } from '@grabjs/superapp-sdk';
 *
 * const toolkit = new AgentToolkit({
 *   confirmCheckout: (summary) => showConfirmDialog(summary),
 *   prepareCheckout: (summary) => myBackend.createGrabPayTransaction(summary),
 * });
 *
 * // Pass toolkit.tools to your LLM, then route each tool call back:
 * const result = await toolkit.call(toolCall.name, toolCall.arguments);
 * ```
 *
 * @public
 */
export class AgentToolkit {
  private readonly options: AgentToolkitOptions;
  private readonly loyalty: LoyaltyModule;
  private readonly scope: ScopeModule;
  private readonly checkout: CheckoutModule;
  private readonly logger = new Logger('AgentToolkit');

  /**
   * Tool definitions to register with your LLM's tool-calling API.
   */
  readonly tools: readonly AgentToolDefinition[] = TOOL_DEFINITIONS;

  constructor(options: AgentToolkitOptions) {
    this.options = options;
    this.loyalty = new LoyaltyModule();
    this.scope = new ScopeModule();
    this.checkout = new CheckoutModule();
  }

  /**
   * Runs a tool requested by the agent.
   *
   * @param name - Tool name from {@link AgentToolkit.tools}.
   * @param args - Tool arguments as produced by the model. Validated before use.
   *
   * @returns This method can return the following `status_code` values:
   * - `200` (OK): The tool ran. `estimate_rewards` returns an {@link AgentEstimateRewardsResult};
   *   `trigger_checkout` returns the `TriggerCheckoutResult` from native checkout.
   * - `204` (No Content): The user declined the checkout confirmation.
   * - `400` (Bad Request): Invalid arguments. The `error` explains why, so the model can retry.
   * - `403` (Forbidden): The MiniApp lacks the required permission.
   * - `404` (Not Found): Unknown tool name.
   * - `424`, `426`, `500`, `501`: Passed through from the underlying module.
   */
  async call(name: 'estimate_rewards', args: unknown): Promise<AgentEstimateRewardsResponse>;
  async call(name: 'trigger_checkout', args: unknown): Promise<AgentTriggerCheckoutResponse>;
  async call(name: string, args: unknown): Promise<AgentToolResponse>;
  async call(name: string, args: unknown): Promise<AgentToolResponse> {
    const startedAt = Date.now();
    let response: AgentToolResponse;
    switch (name) {
      case 'estimate_rewards':
        response = await this.estimateRewards(args);
        break;
      case 'trigger_checkout':
        response = await this.triggerCheckout(args);
        break;
      default:
        response = { status_code: 404, error: `Unknown tool: ${name}` };
    }
    this.emit(name, response.status_code, Date.now() - startedAt);
    return response;
  }

  private async estimateRewards(args: unknown): Promise<AgentEstimateRewardsResponse> {
    const parsed = parse<EstimateRewardsRequest>(AgentEstimateRewardsArgsSchema, args);
    if ('error' in parsed) return { status_code: 400, error: parsed.error };

    const response = await this.loyalty.estimateRewards(parsed.value);
    if (!isOk(response)) return response;

    const totals = new Map<AgentRewardsTotal['currency_code'], number>();
    const unestimated: string[] = [];
    for (const item of response.result.items) {
      if (item.status_code === 'SUCCESS') {
        const { currency_code, amount } = item.result.reward;
        totals.set(currency_code, (totals.get(currency_code) ?? 0) + amount);
      } else {
        unestimated.push(item.id);
      }
    }

    return {
      status_code: 200,
      result: {
        items: response.result.items,
        totals: Array.from(totals, ([currency_code, amount]) => ({ currency_code, amount })),
        unestimated_item_ids: unestimated,
      },
    };
  }

  private async triggerCheckout(args: unknown): Promise<AgentTriggerCheckoutResponse> {
    const parsed = parse<AgentCheckoutSummary>(AgentCheckoutSummarySchema, args);
    if ('error' in parsed) return { status_code: 400, error: parsed.error };
    const summary = parsed.value;

    const access = await this.scope.hasAccessTo('CheckoutModule', 'triggerCheckout');
    if (!isOk(access)) return access;
    if (!access.result) {
      return {
        status_code: 403,
        error: 'Forbidden: The MiniApp needs the mobile.checkout scope before checkout',
      };
    }

    let confirmed: boolean;
    try {
      confirmed = (await this.options.confirmCheckout(summary)) === true;
    } catch (error) {
      return this.callbackError('confirmCheckout', error);
    }
    if (!confirmed) return { status_code: 204 };

    let request: TriggerCheckoutRequest;
    try {
      request = await this.options.prepareCheckout(summary);
    } catch (error) {
      return this.callbackError('prepareCheckout', error);
    }

    return this.checkout.triggerCheckout(request);
  }

  private callbackError(callback: string, error: unknown): { status_code: 500; error: string } {
    return {
      status_code: 500,
      error: `${callback} failed: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`,
    };
  }

  private emit(tool: string, statusCode: number, durationMs: number): void {
    if (!this.options.onToolCall) return;
    try {
      this.options.onToolCall({ tool, status_code: statusCode, duration_ms: durationMs });
    } catch (error) {
      this.logger.warn(
        'onToolCall',
        `Telemetry hook threw: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`
      );
    }
  }
}
