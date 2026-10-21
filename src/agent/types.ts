/*!
 * Copyright (c) Grab Taxi Holdings PTE LTD (GRAB)
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */

import type { SDKErrorResponse, SDKNoContentResponse, SDKOkResponse } from '../core';
import type { TriggerCheckoutRequest, TriggerCheckoutResult } from '../modules/checkout';
import type { EstimateRewardsResultEntry, EstimateRewardsReward } from '../modules/loyalty';

/**
 * Names of the tools exposed by {@link AgentToolkit}.
 *
 * @group Agent
 * @public
 */
export type AgentToolName = 'estimate_rewards' | 'trigger_checkout';

/**
 * A tool definition that can be passed to an LLM tool-calling API.
 *
 * @group Agent
 * @public
 */
export type AgentToolDefinition = {
  /** Tool name to pass back to `AgentToolkit.call`. */
  name: AgentToolName;
  /** Description of what the tool does, written for the model. */
  description: string;
  /** JSON Schema describing the tool arguments. */
  inputSchema: Record<string, unknown>;
  /** Whether the user must confirm in the MiniApp before the tool takes effect. */
  requiresUserConfirmation: boolean;
};

/**
 * Arguments for the `trigger_checkout` tool. This is what the user sees and confirms.
 *
 * @group Agent
 * @public
 */
export type AgentCheckoutSummary = {
  /** Total to charge in minor units (for example cents). Positive safe integer. */
  amount_in_minor_units: number;
  /** ISO 4217 currency code in upper case, for example `SGD`. */
  currency_code: string;
  /** Short human-readable description of what is being paid for. */
  description: string;
};

/**
 * Total points earned for one reward currency across all estimated items.
 *
 * @group Agent
 * @public
 */
export type AgentRewardsTotal = {
  /** Reward currency. */
  currency_code: EstimateRewardsReward['currency_code'];
  /** Sum of `reward.amount` for successfully estimated items. */
  amount: number;
};

/**
 * Result of the `estimate_rewards` tool.
 *
 * @group Agent
 * @public
 */
export type AgentEstimateRewardsResult = {
  /** Per-item entries as returned by `LoyaltyModule.estimateRewards`. */
  items: EstimateRewardsResultEntry[];
  /** Points totals per reward currency, counting only `SUCCESS` entries. */
  totals: AgentRewardsTotal[];
  /** IDs of items that did not earn an estimate (`NOT_APPLICABLE` or `ERROR`). */
  unestimated_item_ids: string[];
};

/**
 * Response of the `estimate_rewards` tool.
 *
 * @group Agent
 * @public
 */
export type AgentEstimateRewardsResponse =
  | SDKOkResponse<AgentEstimateRewardsResult>
  | SDKErrorResponse<400>
  | SDKErrorResponse<403>
  | SDKErrorResponse<424>
  | SDKErrorResponse<426>
  | SDKErrorResponse<500>
  | SDKErrorResponse<501>;

/**
 * Response of the `trigger_checkout` tool. `204` means the user declined.
 *
 * @group Agent
 * @public
 */
export type AgentTriggerCheckoutResponse =
  | SDKOkResponse<TriggerCheckoutResult>
  | SDKNoContentResponse
  | SDKErrorResponse<400>
  | SDKErrorResponse<403>
  | SDKErrorResponse<424>
  | SDKErrorResponse<500>
  | SDKErrorResponse<501>;

/**
 * Response of `AgentToolkit.call`. Unknown tool names return `404`.
 *
 * @group Agent
 * @public
 */
export type AgentToolResponse =
  | AgentEstimateRewardsResponse
  | AgentTriggerCheckoutResponse
  | SDKErrorResponse<404>;

/**
 * Telemetry event emitted after every tool call. Never contains tool arguments or results.
 *
 * @group Agent
 * @public
 */
export type AgentToolCallEvent = {
  /** Tool name as requested by the agent. */
  tool: string;
  /** Final `status_code` returned to the agent. */
  status_code: number;
  /** Time spent in the tool call, in milliseconds. */
  duration_ms: number;
};

/**
 * Options for {@link AgentToolkit}.
 *
 * @group Agent
 * @public
 */
export type AgentToolkitOptions = {
  /**
   * Shows the checkout summary to the user and resolves `true` only if they approve.
   * Called before any transaction is created.
   */
  confirmCheckout: (summary: AgentCheckoutSummary) => boolean | Promise<boolean>;
  /**
   * Creates the transaction on your backend (`POST /grabpay/partner/v4/charge/init`) and returns
   * the parameters for `CheckoutModule.triggerCheckout`. Called only after the user confirms.
   */
  prepareCheckout: (summary: AgentCheckoutSummary) => Promise<TriggerCheckoutRequest>;
  /** Receives one {@link AgentToolCallEvent} per tool call. Errors thrown here are ignored. */
  onToolCall?: (event: AgentToolCallEvent) => void;
};
