/*!
 * Copyright (c) Grab Taxi Holdings PTE LTD (GRAB)
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */

import * as v from 'valibot';

import type { EstimateRewardsRequest } from '../modules/loyalty';
import type { AgentCheckoutSummary } from './types';

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_REWARD_ITEMS = 50;

const MinorUnitsSchema = v.pipe(
  v.number(),
  v.safeInteger('Amount must be a whole number of minor units'),
  v.minValue(1, 'Amount must be greater than zero')
);

const CurrencyCodeSchema = v.pipe(
  v.string(),
  v.regex(CURRENCY_CODE_PATTERN, 'Currency must be a 3-letter upper-case ISO 4217 code')
);

export const AgentEstimateRewardsArgsSchema: v.GenericSchema<EstimateRewardsRequest> = v.pipe(
  v.strictObject({
    items: v.pipe(
      v.array(
        v.strictObject({
          id: v.pipe(v.string(), v.minLength(1)),
          amount_in_minor_units: MinorUnitsSchema,
          currency_code: CurrencyCodeSchema,
        })
      ),
      v.minLength(1),
      v.maxLength(MAX_REWARD_ITEMS)
    ),
  }),
  v.check(
    ({ items }) => new Set(items.map((item) => item.id)).size === items.length,
    'Duplicate entry id detected'
  )
);

export const AgentCheckoutSummarySchema: v.GenericSchema<AgentCheckoutSummary> = v.strictObject({
  amount_in_minor_units: MinorUnitsSchema,
  currency_code: CurrencyCodeSchema,
  description: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, 'Description is required'),
    v.maxLength(MAX_DESCRIPTION_LENGTH)
  ),
});

export const ESTIMATE_REWARDS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_REWARD_ITEMS,
      description: 'Cart items to estimate. Item ids must be unique.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'amount_in_minor_units', 'currency_code'],
        properties: {
          id: { type: 'string', minLength: 1 },
          amount_in_minor_units: {
            type: 'integer',
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
            description: 'Item price in minor units, e.g. 1250 for SGD 12.50.',
          },
          currency_code: { type: 'string', pattern: CURRENCY_CODE_PATTERN.source },
        },
      },
    },
  },
};

export const TRIGGER_CHECKOUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['amount_in_minor_units', 'currency_code', 'description'],
  properties: {
    amount_in_minor_units: {
      type: 'integer',
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
      description: 'Total to charge in minor units, e.g. 1250 for SGD 12.50.',
    },
    currency_code: { type: 'string', pattern: CURRENCY_CODE_PATTERN.source },
    description: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_DESCRIPTION_LENGTH,
      description: 'What the user is paying for. Shown to the user for confirmation.',
    },
  },
};
