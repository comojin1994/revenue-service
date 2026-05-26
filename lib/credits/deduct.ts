/**
 * Credit deduction integration point.
 *
 * TODO(c1): 크레딧 차감 연동 지점.
 * Real credit accounting is out of scope for this issue (Issue #2). This is a
 * no-op stub so the ingestion orchestrator has a stable seam to call. When the
 * credit system lands, implement:
 *   - balance check (throw / return insufficient when balance < amount)
 *   - atomic deduction tied to the job lifecycle (refund on failure)
 *   - persistence via Supabase (e.g. a `credits_ledger` table)
 */

export interface DeductCreditsResult {
  ok: boolean;
}

export async function deductCredits(
  userId: string | null,
  amount: number,
): Promise<DeductCreditsResult> {
  // TODO(c1): replace no-op with real credit deduction logic.
  void userId;
  void amount;
  return { ok: true };
}
