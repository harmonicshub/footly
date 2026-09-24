/**
 * API CLIENT
 * ----------
 * Small on purpose. The things that matter on a bad connection:
 * timeouts that fire, retries that are safe, and an idempotency key on
 * anything that moves money.
 */

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.footly.ng/v1";

let token: string | null = null;
export const setAuthToken = (t: string | null) => { token = t; };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: unknown) {
    super(message);
  }
  /** Safe to retry without risking a duplicate side effect. */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

interface Opts {
  timeoutMs?: number;
  idempotencyKey?: string;
  retries?: number;
}

async function request<T>(method: string, path: string, body?: unknown, opts: Opts = {}): Promise<T> {
  const { timeoutMs = 12_000, retries = method === "GET" ? 2 : 0 } = opts;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(BASE + path, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // Same key across retries — the server dedupes, so a flaky
          // network cannot place the same bet twice.
          ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      clearTimeout(timer);
      const text = await res.text();
      const parsed = text ? safeJson(text) : null;

      if (!res.ok) {
        const err = new ApiError(
          res.status,
          (parsed as any)?.code ?? "unknown",
          (parsed as any)?.message ?? `HTTP ${res.status}`,
          parsed
        );
        if (err.retryable && attempt < retries) { await backoff(attempt); continue; }
        throw err;
      }

      return parsed as T;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof ApiError) throw e;
      const err = new ApiError(0, "network", "No connection");
      if (attempt < retries) { await backoff(attempt); continue; }
      throw err;
    }
  }
}

const safeJson = (t: string) => { try { return JSON.parse(t); } catch { return null; } };
const backoff = (n: number) => new Promise((r) => setTimeout(r, Math.min(400 * 2 ** n, 3000)));

export const api = {
  get: <T>(p: string, o?: Opts) => request<T>("GET", p, undefined, o),
  post: <T>(p: string, b?: unknown, o?: Opts) => request<T>("POST", p, b, o),
  patch: <T>(p: string, b?: unknown, o?: Opts) => request<T>("PATCH", p, b, o),
};

/* ------------------------------------------------------------------ */
/* Typed endpoints the app actually calls                              */
/* ------------------------------------------------------------------ */

export const endpoints = {
  fixtures: (sport = "football", filter = "today") =>
    api.get<any[]>(`/fixtures?sport=${sport}&filter=${filter}`),

  marketBoard: (eventId: string) =>
    api.get<any>(`/events/${eventId}/markets`),

  loadBookingCode: (code: string) =>
    api.get<any>(`/booking-codes/${encodeURIComponent(code)}`),

  createBookingCode: (selections: unknown[]) =>
    api.post<{ code: string }>("/booking-codes", { selections }),

  /**
   * priceChangePolicy defaults to accept_higher: take the bet if the
   * price improved, reject and re-quote if it worsened. Silently
   * accepting a worse price is how you lose trust permanently.
   */
  placeBet: (payload: {
    selections: { marketId: string; outcomeId: string; quotedPrice: number; quotedVersion: number }[];
    stakeKobo: number;
    betType: "single" | "multiple" | "system" | "builder";
    priceChangePolicy?: "reject" | "accept_higher" | "accept_any";
  }, idempotencyKey: string) =>
    api.post<any>("/bets", { priceChangePolicy: "accept_higher", ...payload }, { idempotencyKey }),

  myBets: (status: "open" | "settled" = "open") =>
    api.get<any[]>(`/bets?status=${status}`),

  cashoutQuote: (betId: string) => api.get<any>(`/bets/${betId}/cashout`),
  acceptCashout: (betId: string, amountKobo: number, key: string) =>
    api.post<any>(`/bets/${betId}/cashout`, { amountKobo }, { idempotencyKey: key }),

  initDeposit: (amountKobo: number, key: string) =>
    api.post<{ checkoutUrl: string }>("/wallet/deposits", { amountKobo }, { idempotencyKey: key }),

  requestWithdrawal: (amountKobo: number, bankAccountId: string, key: string) =>
    api.post<any>("/wallet/withdrawals", { amountKobo, bankAccountId }, { idempotencyKey: key }),
};
