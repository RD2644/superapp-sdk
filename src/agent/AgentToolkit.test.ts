/*!
 * Copyright (c) Grab Taxi Holdings PTE LTD (GRAB)
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EstimateRewardsResponse } from '../modules/loyalty';
import { AgentToolkit } from './AgentToolkit';
import type { AgentToolkitOptions } from './types';

const GRAB_UA = 'Grab/5.424.0 (iPhone; iOS 16.0)';
const MODULES = ['LoyaltyModule', 'ScopeModule', 'CheckoutModule'] as const;

type Invoke = ReturnType<typeof vi.fn>;

let loyaltyInvoke: Invoke;
let scopeInvoke: Invoke;
let checkoutInvoke: Invoke;

function install(name: (typeof MODULES)[number], invoke: Invoke): void {
  (window as unknown as Record<string, { invoke: Invoke }>)[`Wrapped${name}`] = { invoke };
}

const rewardsOk = (items: unknown[]): EstimateRewardsResponse =>
  ({ status_code: 200, result: { items } }) as EstimateRewardsResponse;

const successEntry = (id: string, amount: number, currency_code = 'GRAB-POINT') => ({
  id,
  status_code: 'SUCCESS',
  result: { reward: { amount, currency_code, display_amount: String(amount) } },
});

const SUMMARY = { amount_in_minor_units: 1250, currency_code: 'SGD', description: 'Lunch order' };
const PREPARED = { partnerTxID: 'tx-1', request: 'signed', sessionID: 's-1' };

function createToolkit(overrides: Partial<AgentToolkitOptions> = {}) {
  const options = {
    confirmCheckout: vi.fn().mockResolvedValue(true),
    prepareCheckout: vi.fn().mockResolvedValue(PREPARED),
    onToolCall: vi.fn(),
    ...overrides,
  };
  return { toolkit: new AgentToolkit(options), options };
}

beforeEach(() => {
  vi.stubGlobal('navigator', { userAgent: GRAB_UA });
  loyaltyInvoke = vi.fn().mockResolvedValue(rewardsOk([]));
  scopeInvoke = vi.fn().mockResolvedValue({ status_code: 200, result: true });
  checkoutInvoke = vi
    .fn()
    .mockResolvedValue({ status_code: 200, result: { status: 'Success', transactionID: 'tx-1' } });
  install('LoyaltyModule', loyaltyInvoke);
  install('ScopeModule', scopeInvoke);
  install('CheckoutModule', checkoutInvoke);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of MODULES)
    delete (window as unknown as Record<string, unknown>)[`Wrapped${name}`];
});

describe('AgentToolkit', () => {
  describe('tools', () => {
    it('exposes estimate_rewards and trigger_checkout with JSON schemas', () => {
      const { toolkit } = createToolkit();
      expect(toolkit.tools.map((tool) => tool.name)).toEqual([
        'estimate_rewards',
        'trigger_checkout',
      ]);
      expect(toolkit.tools[0].requiresUserConfirmation).toBe(false);
      expect(toolkit.tools[1].requiresUserConfirmation).toBe(true);
      expect(toolkit.tools[1].inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['amount_in_minor_units', 'currency_code', 'description'],
      });
    });
  });

  describe('call', () => {
    it('returns 404 for unknown tools', async () => {
      const { toolkit } = createToolkit();
      const response = await toolkit.call('transfer_money', {});
      expect(response).toEqual({ status_code: 404, error: 'Unknown tool: transfer_money' });
    });
  });

  describe('estimate_rewards', () => {
    it('passes validated items to LoyaltyModule and totals points per reward currency', async () => {
      loyaltyInvoke.mockResolvedValue(
        rewardsOk([
          successEntry('a', 100),
          successEntry('b', 250),
          successEntry('c', 40, 'OVO-POINT'),
          { id: 'd', status_code: 'NOT_APPLICABLE', reason_code: 'invalid_currency' },
          { id: 'e', status_code: 'ERROR', reason_code: 'estimate_failed' },
        ])
      );
      const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
        id,
        amount_in_minor_units: 1000,
        currency_code: id === 'c' ? 'IDR' : 'SGD',
      }));
      const { toolkit } = createToolkit();

      const response = await toolkit.call('estimate_rewards', { items });

      expect(loyaltyInvoke).toHaveBeenCalledWith('estimateRewards', { items });
      expect(response.status_code).toBe(200);
      if (response.status_code !== 200) return;
      expect(response.result.totals).toEqual([
        { currency_code: 'GRAB-POINT', amount: 350 },
        { currency_code: 'OVO-POINT', amount: 40 },
      ]);
      expect(response.result.unestimated_item_ids).toEqual(['d', 'e']);
      expect(response.result.items).toHaveLength(5);
    });

    it('returns empty totals when no item earns points', async () => {
      loyaltyInvoke.mockResolvedValue(
        rewardsOk([{ id: 'a', status_code: 'NOT_APPLICABLE', reason_code: 'country_restriction' }])
      );
      const { toolkit } = createToolkit();
      const response = await toolkit.call('estimate_rewards', {
        items: [{ id: 'a', amount_in_minor_units: 1, currency_code: 'SGD' }],
      });
      expect(response).toMatchObject({
        status_code: 200,
        result: { totals: [], unestimated_item_ids: ['a'] },
      });
    });

    it.each([
      ['zero amount', { amount_in_minor_units: 0 }],
      ['negative amount', { amount_in_minor_units: -500 }],
      ['fractional minor units', { amount_in_minor_units: 12.5 }],
      ['amount as string', { amount_in_minor_units: '1250' }],
      ['NaN amount', { amount_in_minor_units: Number.NaN }],
      ['infinite amount', { amount_in_minor_units: Number.POSITIVE_INFINITY }],
      ['amount above MAX_SAFE_INTEGER', { amount_in_minor_units: Number.MAX_SAFE_INTEGER + 2 }],
      ['lower-case currency', { currency_code: 'sgd' }],
      ['2-letter currency', { currency_code: 'SG' }],
      ['empty id', { id: '' }],
      ['unexpected field', { discount: 100 }],
    ])('rejects %s with 400 without calling native', async (_label, patch) => {
      const { toolkit } = createToolkit();
      const item = { id: 'a', amount_in_minor_units: 1250, currency_code: 'SGD', ...patch };
      const response = await toolkit.call('estimate_rewards', { items: [item] });
      expect(response.status_code).toBe(400);
      expect(loyaltyInvoke).not.toHaveBeenCalled();
    });

    it.each([
      ['empty cart', { items: [] }],
      ['missing items', {}],
      ['non-object args', 'two coffees'],
      [
        'duplicate ids',
        {
          items: [
            { id: 'a', amount_in_minor_units: 1, currency_code: 'SGD' },
            { id: 'a', amount_in_minor_units: 2, currency_code: 'SGD' },
          ],
        },
      ],
      [
        'more than 50 items',
        {
          items: Array.from({ length: 51 }, (_, i) => ({
            id: `i${i}`,
            amount_in_minor_units: 1,
            currency_code: 'SGD',
          })),
        },
      ],
    ])('rejects %s with 400', async (_label, args) => {
      const { toolkit } = createToolkit();
      const response = await toolkit.call('estimate_rewards', args);
      expect(response.status_code).toBe(400);
      expect(loyaltyInvoke).not.toHaveBeenCalled();
    });

    it('accepts the largest safe amount', async () => {
      const { toolkit } = createToolkit();
      const response = await toolkit.call('estimate_rewards', {
        items: [{ id: 'a', amount_in_minor_units: Number.MAX_SAFE_INTEGER, currency_code: 'IDR' }],
      });
      expect(response.status_code).toBe(200);
    });

    it('passes through native errors', async () => {
      loyaltyInvoke.mockResolvedValue({ status_code: 403, error: 'Forbidden' });
      const { toolkit } = createToolkit();
      const response = await toolkit.call('estimate_rewards', {
        items: [{ id: 'a', amount_in_minor_units: 1, currency_code: 'SGD' }],
      });
      expect(response).toEqual({ status_code: 403, error: 'Forbidden' });
    });

    it('returns 501 outside the Grab app', async () => {
      vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/120' });
      const { toolkit } = createToolkit();
      const response = await toolkit.call('estimate_rewards', {
        items: [{ id: 'a', amount_in_minor_units: 1, currency_code: 'SGD' }],
      });
      expect(response.status_code).toBe(501);
    });
  });

  describe('trigger_checkout', () => {
    it('checks scope, confirms, prepares, then triggers checkout in that order', async () => {
      const order: string[] = [];
      scopeInvoke.mockImplementation(async () => {
        order.push('scope');
        return { status_code: 200, result: true };
      });
      const confirmCheckout = vi.fn(async () => {
        order.push('confirm');
        return true;
      });
      const prepareCheckout = vi.fn(async () => {
        order.push('prepare');
        return PREPARED;
      });
      checkoutInvoke.mockImplementation(async () => {
        order.push('checkout');
        return { status_code: 200, result: { status: 'Success', transactionID: 'tx-1' } };
      });
      const { toolkit } = createToolkit({ confirmCheckout, prepareCheckout });

      const response = await toolkit.call('trigger_checkout', {
        ...SUMMARY,
        description: '  Lunch order  ',
      });

      expect(order).toEqual(['scope', 'confirm', 'prepare', 'checkout']);
      expect(scopeInvoke).toHaveBeenCalledWith('hasAccessTo', {
        module: 'CheckoutModule',
        method: 'triggerCheckout',
      });
      expect(confirmCheckout).toHaveBeenCalledWith(SUMMARY);
      expect(prepareCheckout).toHaveBeenCalledWith(SUMMARY);
      expect(checkoutInvoke).toHaveBeenCalledWith('triggerCheckout', PREPARED);
      expect(response).toEqual({
        status_code: 200,
        result: { status: 'Success', transactionID: 'tx-1' },
      });
    });

    it('returns 204 and creates no transaction when the user declines', async () => {
      const { toolkit, options } = createToolkit({
        confirmCheckout: vi.fn().mockResolvedValue(false),
      });
      const response = await toolkit.call('trigger_checkout', SUMMARY);
      expect(response).toEqual({ status_code: 204 });
      expect(options.prepareCheckout).not.toHaveBeenCalled();
      expect(checkoutInvoke).not.toHaveBeenCalled();
    });

    it('treats a truthy non-boolean confirmation as declined', async () => {
      const { toolkit } = createToolkit({
        confirmCheckout: vi.fn().mockResolvedValue('yes' as unknown as boolean),
      });
      const response = await toolkit.call('trigger_checkout', SUMMARY);
      expect(response).toEqual({ status_code: 204 });
      expect(checkoutInvoke).not.toHaveBeenCalled();
    });

    it('accepts a synchronous confirmCheckout', async () => {
      const { toolkit } = createToolkit({ confirmCheckout: () => true });
      const response = await toolkit.call('trigger_checkout', SUMMARY);
      expect(response.status_code).toBe(200);
    });

    it('returns 403 without asking the user when checkout permission is missing', async () => {
      scopeInvoke.mockResolvedValue({ status_code: 200, result: false });
      const { toolkit, options } = createToolkit();
      const response = await toolkit.call('trigger_checkout', SUMMARY);
      expect(response.status_code).toBe(403);
      expect(options.confirmCheckout).not.toHaveBeenCalled();
      expect(checkoutInvoke).not.toHaveBeenCalled();
    });

    it('passes through scope check errors', async () => {
      scopeInvoke.mockResolvedValue({ status_code: 424, error: 'Failed Dependency' });
      const { toolkit, options } = createToolkit();
      const response = await toolkit.call('trigger_checkout', SUMMARY);
      expect(response).toEqual({ status_code: 424, error: 'Failed Dependency' });
      expect(options.confirmCheckout).not.toHaveBeenCalled();
    });

    it('returns 500 when confirmCheckout throws', async () => {
      const { toolkit, options } = createToolkit({
        confirmCheckout: vi.fn().mockRejectedValue(new Error('dialog crashed')),
      });
      const response = await toolkit.call('trigger_checkout', SUMMARY);
      expect(response).toEqual({
        status_code: 500,
        error: 'confirmCheckout failed: dialog crashed',
      });
      expect(options.prepareCheckout).not.toHaveBeenCalled();
    });

    it('returns 500 when prepareCheckout throws and does not trigger checkout', async () => {
      const { toolkit } = createToolkit({
        prepareCheckout: vi.fn().mockRejectedValue(new Error('backend 503')),
      });
      const response = await toolkit.call('trigger_checkout', SUMMARY);
      expect(response).toEqual({ status_code: 500, error: 'prepareCheckout failed: backend 503' });
      expect(checkoutInvoke).not.toHaveBeenCalled();
    });

    it.each([
      ['cancelled', { status: 'Cancel' }],
      ['failed', { status: 'Failure', transactionID: 't', errorCode: 'E1', errorMessage: 'no' }],
      ['pending', { status: 'Pending', transactionID: 't' }],
    ])('returns %s checkout results unchanged', async (_label, result) => {
      checkoutInvoke.mockResolvedValue({ status_code: 200, result });
      const { toolkit } = createToolkit();
      const response = await toolkit.call('trigger_checkout', SUMMARY);
      expect(response).toEqual({ status_code: 200, result });
    });

    it.each([
      ['zero amount', { amount_in_minor_units: 0 }],
      ['negative amount', { amount_in_minor_units: -1250 }],
      ['major units with decimals', { amount_in_minor_units: 12.5 }],
      ['amount above MAX_SAFE_INTEGER', { amount_in_minor_units: 2 ** 60 }],
      ['lower-case currency', { currency_code: 'sgd' }],
      ['currency symbol', { currency_code: 'S$' }],
      ['blank description', { description: '   ' }],
      ['description over 200 characters', { description: 'x'.repeat(201) }],
      ['injected checkout parameters', { partnerTxID: 'attacker-tx' }],
    ])('rejects %s with 400 before checking scope or asking the user', async (_label, patch) => {
      const { toolkit, options } = createToolkit();
      const response = await toolkit.call('trigger_checkout', { ...SUMMARY, ...patch });
      expect(response.status_code).toBe(400);
      expect(scopeInvoke).not.toHaveBeenCalled();
      expect(options.confirmCheckout).not.toHaveBeenCalled();
    });
  });

  describe('telemetry', () => {
    it('emits one event per call without arguments or results', async () => {
      const onToolCall = vi.fn();
      const { toolkit } = createToolkit({ onToolCall });
      await toolkit.call('trigger_checkout', SUMMARY);
      await toolkit.call('nope', { secret: 'x' });

      expect(onToolCall).toHaveBeenCalledTimes(2);
      const [first, second] = onToolCall.mock.calls.map(([event]) => event);
      expect(Object.keys(first).sort()).toEqual(['duration_ms', 'status_code', 'tool']);
      expect(first).toMatchObject({ tool: 'trigger_checkout', status_code: 200 });
      expect(first.duration_ms).toBeGreaterThanOrEqual(0);
      expect(second).toMatchObject({ tool: 'nope', status_code: 404 });
    });

    it('ignores errors thrown by the telemetry hook', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { toolkit } = createToolkit({
        onToolCall: () => {
          throw new Error('hook broke');
        },
      });
      const response = await toolkit.call('trigger_checkout', SUMMARY);
      expect(response.status_code).toBe(200);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('hook broke'));
      warn.mockRestore();
    });
  });
});
