/**
 * PAYMENT PROVIDER ADAPTERS
 * -------------------------
 * Paystack and Flutterwave behind one interface. Two providers is not
 * over-engineering here — Nigerian PSPs have bad afternoons, and the
 * ability to flip a flag and route deposits elsewhere has saved more
 * than one Saturday.
 *
 * Amounts are kobo everywhere in our code. Paystack also uses kobo.
 * Flutterwave uses naira with decimals, so the adapter converts at the
 * boundary and nowhere else.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type PspName = "paystack" | "flutterwave";

export interface ChargeInit {
  reference: string;
  amountKobo: number;
  email: string;
  phone: string;
  /** Channels to offer. Bank transfer and USSD matter more than card here. */
  channels?: ("card" | "bank" | "ussd" | "bank_transfer" | "qr")[];
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeResult {
  checkoutUrl: string;
  providerRef: string;
}

export interface VerifiedCharge {
  providerRef: string;
  reference: string;
  amountKobo: number;
  feeKobo: number;
  status: "success" | "failed" | "pending" | "abandoned";
  channel: string;
  paidAt?: string;
  /** Card/account fingerprint — used for fraud checks, never displayed. */
  authorizationSignature?: string;
  customerName?: string;
}

export interface TransferRecipient {
  recipientCode: string;
  accountName: string;
}

export interface TransferResult {
  providerRef: string;
  status: "pending" | "success" | "failed" | "reversed";
  message?: string;
}

export interface PspAdapter {
  name: PspName;
  initCharge(input: ChargeInit): Promise<ChargeResult>;
  /** ALWAYS call this before crediting. Webhook bodies are a hint, not proof. */
  verifyCharge(reference: string): Promise<VerifiedCharge>;
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean;
  resolveAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string }>;
  createRecipient(args: { bankCode: string; accountNumber: string; name: string }): Promise<TransferRecipient>;
  transfer(args: { recipientCode: string; amountKobo: number; reference: string; reason: string }): Promise<TransferResult>;
  fetchTransfer(reference: string): Promise<TransferResult>;
  listBanks(): Promise<{ code: string; name: string }[]>;
}

/* ================================================================== */
/* Paystack                                                            */
/* ================================================================== */

export class PaystackAdapter implements PspAdapter {
  name: PspName = "paystack";
  private base = "https://api.paystack.co";

  constructor(private secretKey: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status === false) {
      throw new PspError(this.name, body.message ?? `HTTP ${res.status}`, res.status);
    }
    return body.data as T;
  }

  async initCharge(i: ChargeInit): Promise<ChargeResult> {
    const data = await this.call<any>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        reference: i.reference,
        amount: i.amountKobo,               // Paystack is kobo already
        email: i.email,
        channels: i.channels ?? ["card", "bank", "ussd", "bank_transfer"],
        callback_url: i.callbackUrl,
        metadata: { phone: i.phone, ...i.metadata },
      }),
    });
    return { checkoutUrl: data.authorization_url, providerRef: data.reference };
  }

  async verifyCharge(reference: string): Promise<VerifiedCharge> {
    const d = await this.call<any>(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      providerRef: d.reference,
      reference: d.reference,
      amountKobo: Number(d.amount),
      feeKobo: Number(d.fees ?? 0),
      status: d.status === "success" ? "success"
            : d.status === "abandoned" ? "abandoned"
            : d.status === "failed" ? "failed" : "pending",
      channel: d.channel,
      paidAt: d.paid_at,
      authorizationSignature: d.authorization?.signature,
      customerName: [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(" ") || undefined,
    };
  }

  /**
   * HMAC-SHA512 of the RAW body with the secret key, compared against
   * x-paystack-signature. The raw body matters — if your framework has
   * already parsed and re-serialised the JSON, the hash will not match.
   * Capture the raw buffer in middleware before body parsing.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean {
    const sig = headers["x-paystack-signature"];
    if (!sig) return false;
    const expected = createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    return safeEqual(expected, sig);
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    const d = await this.call<any>(
      `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`
    );
    return { accountName: d.account_name as string };
  }

  async createRecipient(a: { bankCode: string; accountNumber: string; name: string }) {
    const d = await this.call<any>("/transferrecipient", {
      method: "POST",
      body: JSON.stringify({
        type: "nuban",
        name: a.name,
        account_number: a.accountNumber,
        bank_code: a.bankCode,
        currency: "NGN",
      }),
    });
    return { recipientCode: d.recipient_code as string, accountName: d.details?.account_name as string };
  }

  async transfer(a: { recipientCode: string; amountKobo: number; reference: string; reason: string }) {
    const d = await this.call<any>("/transfer", {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        amount: a.amountKobo,
        recipient: a.recipientCode,
        reference: a.reference,
        reason: a.reason,
      }),
    });
    return { providerRef: d.transfer_code as string, status: mapPaystackTransfer(d.status) };
  }

  async fetchTransfer(reference: string) {
    const d = await this.call<any>(`/transfer/verify/${encodeURIComponent(reference)}`);
    return { providerRef: d.transfer_code, status: mapPaystackTransfer(d.status), message: d.reason };
  }

  async listBanks() {
    const d = await this.call<any[]>("/bank?currency=NGN&perPage=200");
    return d.map((b) => ({ code: b.code as string, name: b.name as string }));
  }
}

const mapPaystackTransfer = (s: string): TransferResult["status"] =>
  s === "success" ? "success"
  : s === "failed" ? "failed"
  : s === "reversed" ? "reversed"
  : "pending";

/* ================================================================== */
/* Flutterwave                                                         */
/* ================================================================== */

export class FlutterwaveAdapter implements PspAdapter {
  name: PspName = "flutterwave";
  private base = "https://api.flutterwave.com/v3";

  constructor(private secretKey: string, private webhookHash: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status === "error") {
      throw new PspError(this.name, body.message ?? `HTTP ${res.status}`, res.status);
    }
    return body.data as T;
  }

  async initCharge(i: ChargeInit): Promise<ChargeResult> {
    const d = await this.call<any>("/payments", {
      method: "POST",
      body: JSON.stringify({
        tx_ref: i.reference,
        amount: koboToNaira(i.amountKobo),   // Flutterwave wants naira
        currency: "NGN",
        redirect_url: i.callbackUrl,
        customer: { email: i.email, phonenumber: i.phone },
        meta: i.metadata,
        payment_options: "card,banktransfer,ussd",
      }),
    });
    return { checkoutUrl: d.link, providerRef: i.reference };
  }

  async verifyCharge(reference: string): Promise<VerifiedCharge> {
    const d = await this.call<any>(
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`
    );
    return {
      providerRef: String(d.id),
      reference: d.tx_ref,
      amountKobo: nairaToKobo(Number(d.amount_settled ?? d.amount)),
      feeKobo: nairaToKobo(Number(d.app_fee ?? 0)),
      status: d.status === "successful" ? "success"
            : d.status === "failed" ? "failed" : "pending",
      channel: d.payment_type,
      paidAt: d.created_at,
      authorizationSignature: d.card?.first_6digits ? `${d.card.first_6digits}${d.card.last_4digits}` : undefined,
      customerName: d.customer?.name,
    };
  }

  /**
   * Flutterwave sends a static secret in verif-hash. It is weaker than
   * an HMAC — rotate it regularly and never rely on it alone. The
   * verifyCharge call is the real check.
   */
  verifyWebhook(_rawBody: string, headers: Record<string, string>): boolean {
    const hash = headers["verif-hash"];
    return !!hash && safeEqual(this.webhookHash, hash);
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    const d = await this.call<any>("/accounts/resolve", {
      method: "POST",
      body: JSON.stringify({ account_number: accountNumber, account_bank: bankCode }),
    });
    return { accountName: d.account_name as string };
  }

  /** Flutterwave has no recipient object — the account is passed per transfer. */
  async createRecipient(a: { bankCode: string; accountNumber: string; name: string }) {
    const { accountName } = await this.resolveAccount(a.bankCode, a.accountNumber);
    return { recipientCode: `${a.bankCode}:${a.accountNumber}`, accountName };
  }

  async transfer(a: { recipientCode: string; amountKobo: number; reference: string; reason: string }) {
    const [bankCode, accountNumber] = a.recipientCode.split(":");
    const d = await this.call<any>("/transfers", {
      method: "POST",
      body: JSON.stringify({
        account_bank: bankCode,
        account_number: accountNumber,
        amount: koboToNaira(a.amountKobo),
        narration: a.reason,
        currency: "NGN",
        reference: a.reference,
      }),
    });
    return { providerRef: String(d.id), status: mapFlwTransfer(d.status) };
  }

  async fetchTransfer(reference: string) {
    const d = await this.call<any>(`/transfers?reference=${encodeURIComponent(reference)}`);
    const t = Array.isArray(d) ? d[0] : d;
    return { providerRef: String(t?.id ?? ""), status: mapFlwTransfer(t?.status), message: t?.complete_message };
  }

  async listBanks() {
    const d = await this.call<any[]>("/banks/NG");
    return d.map((b) => ({ code: b.code as string, name: b.name as string }));
  }
}

const mapFlwTransfer = (s: string): TransferResult["status"] =>
  s === "SUCCESSFUL" ? "success"
  : s === "FAILED" ? "failed"
  : s === "REVERSED" ? "reversed"
  : "pending";

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

export class PspError extends Error {
  constructor(public provider: PspName, message: string, public httpStatus?: number) {
    super(`[${provider}] ${message}`);
  }
  /** Safe to retry? Network and 5xx yes; a rejected card no. */
  get retryable() {
    return !this.httpStatus || this.httpStatus >= 500 || this.httpStatus === 429;
  }
}

const koboToNaira = (k: number) => Math.round(k) / 100;
const nairaToKobo = (n: number) => Math.round(n * 100);

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/* ------------------------------------------------------------------ */

/**
 * Routes deposits to whichever provider is healthy. Flip `primary` in
 * config when a PSP starts timing out — no deploy needed.
 */
export class PspRouter {
  constructor(
    private adapters: Record<PspName, PspAdapter>,
    private primary: PspName = "paystack",
  ) {}

  get(name?: PspName): PspAdapter {
    return this.adapters[name ?? this.primary];
  }

  setPrimary(name: PspName) {
    this.primary = name;
  }
}
