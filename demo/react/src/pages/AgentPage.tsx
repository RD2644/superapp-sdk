import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgentToolkit, type AgentCheckoutSummary, type AgentToolResponse } from '@grabjs/superapp-sdk';
import { installMockBridge, isRealGrabApp, uninstallMockBridge } from '../utils/mockBridge';

type CartLine = { id: string; name: string; priceMinor: number; qty: number };

type ChatEntry =
  | { kind: 'user' | 'assistant'; text: string }
  | { kind: 'tool'; name: string; args: unknown; response: AgentToolResponse; durationMs?: number };

type PendingConfirmation = { summary: AgentCheckoutSummary; resolve: (approved: boolean) => void };

const CURRENCY = 'SGD';
const INITIAL_CART: CartLine[] = [
  { id: 'chicken-rice', name: 'Chicken rice', priceMinor: 550, qty: 2 },
  { id: 'kopi', name: 'Kopi', priceMinor: 180, qty: 2 },
  { id: 'kaya-toast', name: 'Kaya toast set', priceMinor: 420, qty: 1 },
];
const SUGGESTIONS = ['How many points will I earn?', 'Check out for me'];

const formatMoney = (minor: number) => `${CURRENCY} ${(minor / 100).toFixed(2)}`;

function describe(name: string, response: AgentToolResponse): string {
  if (name === 'estimate_rewards' && response.status_code === 200 && 'result' in response && 'totals' in response.result) {
    const { totals, unestimated_item_ids } = response.result;
    const points = totals.map((t) => `${t.amount} ${t.currency_code === 'GRAB-POINT' ? 'GrabPoints' : 'OVO Points'}`).join(' and ');
    const skipped = unestimated_item_ids.length ? ` ${unestimated_item_ids.length} item(s) don't earn points.` : '';
    return points ? `You'd earn about ${points} on this cart.${skipped}` : `This cart doesn't earn points.${skipped}`;
  }
  if (name === 'trigger_checkout') {
    if (response.status_code === 204) return "No problem, I didn't pay for anything.";
    if (response.status_code === 200 && 'result' in response && 'status' in response.result) {
      const result = response.result;
      if (result.status === 'Success') return `Paid. Transaction ${result.transactionID}.`;
      if (result.status === 'Cancel') return 'You cancelled the payment in Grab checkout.';
      if (result.status === 'Pending') return `The payment is pending (transaction ${result.transactionID}).`;
      return `The payment failed: ${result.errorMessage}`;
    }
    if (response.status_code === 403) return 'This MiniApp needs your checkout permission first.';
  }
  return `That didn't work (${response.status_code}${'error' in response ? `: ${response.error}` : ''}).`;
}

export default function AgentPage() {
  const navigate = useNavigate();
  const [mockBridge, setMockBridge] = useState(() => !isRealGrabApp());
  const [cart, setCart] = useState(INITIAL_CART);
  const [chat, setChat] = useState<ChatEntry[]>([
    { kind: 'assistant', text: 'Hi! I can estimate the GrabRewards points for your cart, or check out once you confirm.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const lastDuration = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (mockBridge) installMockBridge();
    else uninstallMockBridge();
  }, [mockBridge]);

  const lines = cart.filter((line) => line.qty > 0);
  const totalMinor = lines.reduce((sum, line) => sum + line.priceMinor * line.qty, 0);

  function createToolkit() {
    return new AgentToolkit({
      confirmCheckout: (summary) => new Promise<boolean>((resolve) => setPending({ summary, resolve })),
      prepareCheckout: async (summary) => {
        if (!mockBridge) {
          // A real MiniApp calls its backend here to create the GrabPay transaction.
          throw new Error('Connect prepareCheckout to your backend (POST /grabpay/partner/v4/charge/init)');
        }
        return { partnerTxID: `demo-${Date.now()}`, request: 'mock-signed-request', amount: summary.amount_in_minor_units };
      },
      onToolCall: (event) => {
        lastDuration.current = event.duration_ms;
      },
    });
  }

  // Scripted stand-in for an LLM: maps the message to a tool call with arguments built from the cart.
  function planToolCall(text: string): { name: 'estimate_rewards' | 'trigger_checkout'; args: unknown } | null {
    if (/point|reward|earn/i.test(text)) {
      return {
        name: 'estimate_rewards',
        args: { items: lines.map((line) => ({ id: line.id, amount_in_minor_units: line.priceMinor * line.qty, currency_code: CURRENCY })) },
      };
    }
    if (/pay|check ?out|buy|order/i.test(text)) {
      const count = lines.reduce((sum, line) => sum + line.qty, 0);
      return {
        name: 'trigger_checkout',
        args: { amount_in_minor_units: totalMinor, currency_code: CURRENCY, description: `${count} items from Demo Kopitiam` },
      };
    }
    return null;
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput('');
    setChat((prev) => [...prev, { kind: 'user', text }]);
    const plan = planToolCall(text);
    if (!plan) {
      setChat((prev) => [...prev, { kind: 'assistant', text: 'I can estimate points on your cart or check out for you. Try one of the suggestions.' }]);
      return;
    }
    setBusy(true);
    const response = await createToolkit().call(plan.name, plan.args);
    setBusy(false);
    setChat((prev) => [
      ...prev,
      { kind: 'tool', name: plan.name, args: plan.args, response, durationMs: lastDuration.current },
      { kind: 'assistant', text: describe(plan.name, response) },
    ]);
  }

  function answerConfirmation(approved: boolean) {
    pending?.resolve(approved);
    setPending(null);
  }

  function changeQty(id: string, delta: number) {
    setCart((prev) => prev.map((line) => (line.id === id ? { ...line, qty: Math.max(0, line.qty + delta) } : line)));
  }

  return (
    <div className="p-4 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">Shopping assistant</h1>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mockBridge} onChange={(e) => setMockBridge(e.target.checked)} />
          Mock bridge
        </label>
      </div>
      {mockBridge && (
        <p className="text-xs text-yellow-500 mb-3">
          Mock bridge on: native calls are simulated (made-up rate of 1 GrabPoint per SGD 1, fake checkout).
        </p>
      )}

      <section className="border border-gray-300 rounded p-3 mb-4">
        <h2 className="font-semibold mb-2">Cart</h2>
        {cart.map((line) => (
          <div key={line.id} className="flex items-center justify-between py-1 text-sm">
            <span>{line.name} <span className="text-gray-500">{formatMoney(line.priceMinor)}</span></span>
            <span className="flex items-center gap-2">
              <button aria-label={`Remove one ${line.name}`} className="px-2 border rounded" onClick={() => changeQty(line.id, -1)}>-</button>
              <span className="w-4 text-center">{line.qty}</span>
              <button aria-label={`Add one ${line.name}`} className="px-2 border rounded" onClick={() => changeQty(line.id, 1)}>+</button>
            </span>
          </div>
        ))}
        <p className="mt-2 font-semibold text-right">Total: {formatMoney(totalMinor)}</p>
      </section>

      <section className="space-y-2 mb-3" aria-live="polite">
        {chat.map((entry, i) =>
          entry.kind === 'tool' ? (
            <details key={i} className="text-xs border border-dashed border-gray-400 rounded p-2">
              <summary>
                Tool call <code>{entry.name}</code> → <strong>{entry.response.status_code}</strong>
                {entry.durationMs !== undefined && ` (${entry.durationMs} ms)`}
              </summary>
              <pre className="whitespace-pre-wrap mt-1">args: {JSON.stringify(entry.args, null, 2)}</pre>
              <pre className="whitespace-pre-wrap mt-1">response: {JSON.stringify(entry.response, null, 2)}</pre>
            </details>
          ) : (
            <p
              key={i}
              className={`rounded px-3 py-2 text-sm ${entry.kind === 'user' ? 'bg-green-700 text-white ml-8' : 'bg-gray-200 text-gray-900 mr-8'}`}
            >
              {entry.text}
            </p>
          )
        )}
        {busy && !pending && <p className="text-sm text-gray-500">Working…</p>}
      </section>

      <div className="flex flex-wrap gap-2 mb-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} disabled={busy} onClick={() => send(s)} className="text-sm border border-green-600 text-green-600 rounded-full px-3 py-1 disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the assistant…"
          className="flex-1 p-2 border border-gray-300 rounded bg-white text-gray-900"
        />
        <button type="submit" disabled={busy} className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 rounded disabled:opacity-50">
          Send
        </button>
      </form>
      <button onClick={() => navigate('/index')} className="w-full mt-4 bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded">
        Back to Home
      </button>

      {pending && (
        <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center">
          <div className="bg-white text-gray-900 rounded-t-lg sm:rounded-lg p-4 w-full max-w-md">
            <h2 id="confirm-title" className="text-lg font-bold mb-2">Confirm payment</h2>
            <p className="text-sm mb-1">The assistant wants to pay for:</p>
            <p className="font-semibold">{pending.summary.description}</p>
            <p className="text-2xl font-bold my-2">{pending.summary.currency_code} {(pending.summary.amount_in_minor_units / 100).toFixed(2)}</p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => answerConfirmation(false)} className="flex-1 border border-gray-400 rounded py-2">Cancel</button>
              <button onClick={() => answerConfirmation(true)} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold rounded py-2">Confirm and pay</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
