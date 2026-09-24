/**
 * DEPOSIT SERVICE
 * ---------------
 * The one rule that matters: NEVER credit from a webhook body.
 *
 * A webhook tells you something happened. It does not tell you what.
 * Always call verifyCharge() and credit the amount the PSP's API
 * returns, not the amount in the payload. Signature verification stops
 * forged webhooks; API verification stops replayed and tampered ones.
 */

import type { Pool } from "pg";
import { LedgerService, POSTINGS } from "./ledger";
import type { PspRouter, PspName, VerifiedCharge } from "./psp";

export const DEPOSIT_LIMITS = {
  minKobo: 100_00,          // ₦100
  maxSingleKobo: 5_000_000_00,
  /** Below this we skip the KYC gate entirely — friction kills signups. */
  tier0CumulativeKobo: 50_000_00,
};

export interface DepositRequest {
  userId: string;
  amountKobo: number;
  provider?: PspName;
  channel?: string;
}

export type DepositRejection =
  | { code: "below_min"; min: number }
  | { code: "above_max"; max: number }
  | { code: "self_excluded" }
  | { code: "deposit_limit"; period: string; remaining: number }
  | { code: "kyc_required"; tier: string };

export class DepositService {
  constructor(
    private pool: Pool,
    private ledger: LedgerService,
    private psp: PspRouter,
    private callbackUrl: string,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Initiation                                                        */
  /* ---------------------------------------------------------------- */

  async initiate(req: DepositRequest): Promise<
    | { ok: true; checkoutUrl: string; reference: string }
    | { ok: false; rejection: DepositRejection }
  > {
    if (req.amountKobo < DEPOSIT_LIMITS.minKobo) {
      return { ok: false, rejection: { code: "below_min", min: DEPOSIT_LIMITS.minKobo } };
    }
    if (req.amountKobo > DEPOSIT_LIMITS.maxSingleKobo) {
      return { ok: false, rejection: { code: "above_max", max: DEPOSIT_LIMITS.maxSingleKobo } };
    }

    const guard = await this.checkGuards(req.userId, req.amountKobo);
    if (guard) return { ok: false, rejection: guard };

    const user = await this.pool.query(
      `SELECT email, phone FROM users WHERE id = $1`, [req.userId]
    );
    if (!user.rowCount) throw new Error("user not found");

    const reference = `dep_${req.userId.replace(/-/g, "").slice(0, 12)}_${Date.now().toString(36)}`;
    const adapter = this.psp.get(req.provider);

    await this.pool.query(
      `INSERT INTO deposits (user_id, provider, provider_ref, amount_kobo, channel, status)
       VALUES ($1, $2, $3, $4, $5, 'initiated')`,
      [req.userId, adapter.name, reference, req.amountKobo, req.channel ?? null]
    );

    const charge = await adapter.initCharge({
      reference,
      amountKobo: req.amountKobo,
      email: user.rows[0].email ?? `${user.rows[0].phone}@footly.ng`,
      phone: user.rows[0].phone,
      callbackUrl: this.callbackUrl,
      metadata: { user_id: req.userId },
    });

    return { ok: true, checkoutUrl: charge.checkoutUrl, reference };
  }

  /* ---------------------------------------------------------------- */
  /* Webhook                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Called from the HTTP handler with the RAW request body. Returns
   * fast — the actual credit happens in `settleCharge`, which is safe
   * to run repeatedly. Respond 200 to the PSP even if processing fails,
   * then retry from your own queue; PSPs disable endpoints that 500.
   */
  async handleWebhook(
    provider: PspName,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<{ accepted: boolean; reason?: string }> {
    const adapter = this.psp.get(provider);

    if (!adapter.verifyWebhook(rawBody, headers)) {
      return { accepted: false, reason: "bad signature" };
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return { accepted: false, reason: "bad json" };
    }

    const reference =
      event?.data?.reference ??
      event?.data?.tx_ref ??
      event?.data?.txRef;

    if (!reference) return { accepted: false, reason: "no reference" };

    const kind = String(event.event ?? event["event.type"] ?? "");
    if (kind.startsWith("transfer") || kind.includes("Transfer")) {
      await this.enqueue("withdrawal_webhook", { provider, reference });
      return { accepted: true };
    }

    await this.enqueue("deposit_verify", { provider, reference });
    return { accepted: true };
  }

  /* ---------------------------------------------------------------- */
  /* Verification and credit                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Idempotent. Runs from the webhook queue, from the browser callback,
   * and from the reconciliation sweep — all three routes converge here
   * and only the first one credits.
   */
  async settleCharge(provider: PspName, reference: string): Promise<
    { credited: boolean; reason?: string }
  > {
    const adapter = this.psp.get(provider);

    const row = await this.pool.query(
      `SELECT id, user_id, amount_kobo, status FROM deposits
        WHERE provider = $1 AND provider_ref = $2`,
      [provider, reference]
    );
    if (!row.rowCount) return { credited: false, reason: "unknown reference" };

    const deposit = row.rows[0];
    if (deposit.status === "succeeded") return { credited: false, reason: "already credited" };

    /* --- the authoritative check --- */
    let verified: VerifiedCharge;
    try {
      verified = await adapter.verifyCharge(reference);
    } catch (e) {
      return { credited: false, reason: `verify failed: ${(e as Error).message}` };
    }

    if (verified.status !== "success") {
      await this.pool.query(
        `UPDATE deposits SET status = $1, raw_payload = $2 WHERE id = $3`,
        [verified.status === "abandoned" ? "abandoned" : "failed", verified as any, deposit.id]
      );
      return { credited: false, reason: `charge ${verified.status}` };
    }

    /**
     * Amount mismatch means someone tampered with the init call or the
     * PSP settled differently. Credit the VERIFIED amount, flag the row,
     * and let ops look at it — do not silently trust either number.
     */
    const amount = verified.amountKobo;
    const expected = Number(deposit.amount_kobo);
    const mismatch = amount !== expected;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await this.ledger.post({
        reason: "deposit",
        idempotencyKey: `deposit:${provider}:${reference}`,
        reference: deposit.id,
        note: mismatch ? `amount mismatch: expected ${expected}, got ${amount}` : undefined,
        postings: POSTINGS.deposit(deposit.user_id, amount, verified.feeKobo),
        client,
      });

      await client.query(
        `UPDATE deposits
            SET status = 'succeeded', amount_kobo = $1, fee_kobo = $2,
                channel = COALESCE($3, channel), raw_payload = $4, completed_at = now()
          WHERE id = $5`,
        [amount, verified.feeKobo, verified.channel, verified as any, deposit.id]
      );

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    if (mismatch) await this.flag(deposit.id, "deposit_amount_mismatch");
    await this.afterFirstDeposit(deposit.user_id, amount);

    return { credited: true };
  }

  /* ---------------------------------------------------------------- */
  /* Reconciliation                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Runs every ten minutes. Webhooks get lost — on flaky Nigerian
   * networks more often than the PSP dashboards suggest. This sweep is
   * what stops "I paid and it didn't reflect" from becoming your most
   * common support ticket.
   */
  async reconcilePending(olderThanMinutes = 5): Promise<{ checked: number; credited: number }> {
    const rows = await this.pool.query(
      `SELECT provider, provider_ref FROM deposits
        WHERE status IN ('initiated', 'pending')
          AND created_at < now() - ($1 || ' minutes')::interval
        ORDER BY created_at
        LIMIT 500`,
      [olderThanMinutes]
    );

    let credited = 0;
    for (const r of rows.rows) {
      try {
        const res = await this.settleCharge(r.provider, r.provider_ref);
        if (res.credited) credited++;
      } catch {
        // Leave it pending; the next sweep retries.
      }
    }
    return { checked: rows.rowCount ?? 0, credited };
  }

  /** Abandon anything the punter never completed, so it stops being swept. */
  async expireStale(hours = 24) {
    await this.pool.query(
      `UPDATE deposits SET status = 'abandoned'
        WHERE status = 'initiated' AND created_at < now() - ($1 || ' hours')::interval`,
      [hours]
    );
  }

  /* ---------------------------------------------------------------- */

  private async checkGuards(userId: string, amountKobo: number): Promise<DepositRejection | null> {
    const excl = await this.pool.query(
      `SELECT 1 FROM self_exclusions
        WHERE user_id = $1 AND starts_at <= now()
          AND (ends_at IS NULL OR ends_at > now()) LIMIT 1`,
      [userId]
    );
    if (excl.rowCount) return { code: "self_excluded" };

    // Deposit limits are a legal obligation in most licensed markets and
    // a decency one everywhere. Enforce them here, not in the client.
    const limits = await this.pool.query(
      `SELECT period, amount_kobo FROM user_limits
        WHERE user_id = $1 AND kind = 'deposit' AND effective_at <= now()`,
      [userId]
    );

    for (const l of limits.rows) {
      const interval = l.period === "daily" ? "1 day" : l.period === "weekly" ? "7 days" : "30 days";
      const used = await this.pool.query(
        `SELECT COALESCE(SUM(amount_kobo), 0)::bigint AS total FROM deposits
          WHERE user_id = $1 AND status = 'succeeded'
            AND completed_at > now() - $2::interval`,
        [userId, interval]
      );
      const remaining = Number(l.amount_kobo) - Number(used.rows[0].total);
      if (amountKobo > remaining) {
        return { code: "deposit_limit", period: l.period, remaining: Math.max(0, remaining) };
      }
    }

    return null;
  }

  private async afterFirstDeposit(userId: string, amountKobo: number) {
    const count = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM deposits WHERE user_id = $1 AND status = 'succeeded'`,
      [userId]
    );
    if (count.rows[0].n !== 1) return;
    await this.enqueue("promo_first_deposit", { userId, amountKobo });
  }

  private async flag(depositId: string, reason: string) {
    await this.pool.query(
      `INSERT INTO audit_log (actor_type, action, entity, entity_id, after)
       VALUES ('system', $1, 'deposit', $2, '{}'::jsonb)`,
      [reason, depositId]
    );
  }

  /** Replace with your BullMQ / SQS producer. */
  private async enqueue(_job: string, _payload: unknown): Promise<void> {}
}
