const MOCK_USER_AGENT = 'Grab/5.424.0 (iPhone; iOS 17.0) SuperAppSDKDemoMock';
const MOCKED_MODULES = ['WrappedLoyaltyModule', 'WrappedScopeModule', 'WrappedCheckoutModule'];

type MockInvoke = (method: string, params?: unknown) => Promise<unknown>;
type RewardItem = { id: string; amount_in_minor_units: number; currency_code: string };

const windowRecord = window as unknown as Record<string, { invoke: MockInvoke } | undefined>;

export function isRealGrabApp(): boolean {
  return /Grab[A-Za-z]*\/v?\d+\.\d+\.\d+/i.test(navigator.userAgent) && !navigator.userAgent.includes('SuperAppSDKDemoMock');
}

// Demo-only stand-in for the native bridge so the flow is clickable in a desktop browser.
// The reward rate (1 GrabPoint per SGD 1) is made up for illustration.
export function installMockBridge(): void {
  Object.defineProperty(navigator, 'userAgent', { get: () => MOCK_USER_AGENT, configurable: true });

  windowRecord.WrappedLoyaltyModule = {
    invoke: async (_method, params) => {
      const { items } = params as { items: RewardItem[] };
      return {
        status_code: 200,
        result: {
          items: items.map((item) =>
            item.currency_code === 'SGD'
              ? {
                  id: item.id,
                  status_code: 'SUCCESS',
                  result: {
                    reward: {
                      amount: Math.floor(item.amount_in_minor_units / 100),
                      currency_code: 'GRAB-POINT',
                      display_amount: String(Math.floor(item.amount_in_minor_units / 100)),
                    },
                  },
                }
              : { id: item.id, status_code: 'NOT_APPLICABLE', reason_code: 'invalid_currency' }
          ),
        },
      };
    },
  };
  windowRecord.WrappedScopeModule = { invoke: async () => ({ status_code: 200, result: true }) };
  windowRecord.WrappedCheckoutModule = {
    invoke: async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { status_code: 200, result: { status: 'Success', transactionID: `mock-tx-${Date.now()}` } };
    },
  };
}

export function uninstallMockBridge(): void {
  delete (navigator as unknown as Record<string, unknown>).userAgent;
  for (const name of MOCKED_MODULES) delete windowRecord[name];
}
