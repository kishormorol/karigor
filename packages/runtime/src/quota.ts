/**
 * The provider says the usage allowance is used up (a subscription's weekly limit, an API
 * account without credit). Not a failure of the work: the project pauses and carries on later.
 * Thrown by adapters so it passes through workers, judges and gates to the orchestrator.
 */
export class QuotaError extends Error {
  override name = "QuotaError";
  constructor(
    message: string,
    /** The provider's own words on when it resets, when it said ("Oct 26 at 1pm"). */
    readonly resets?: string,
  ) {
    super(message);
  }
}

const QUOTA = /\b(weekly|daily|monthly|usage|plan|session)\s+limit\b|\bhit your( [a-z]+)? limit\b|\blimit (reached|exceeded)\b|\bquota\b|\bcredit balance\b|\bout of credits?\b|\bbilling\b/i;

/** A QuotaError when `text` is a provider's "allowance used up" message, else undefined. */
export function quotaFrom(text: string): QuotaError | undefined {
  if (!QUOTA.test(text)) return undefined;
  const resets = /resets?\s+(?:at\s+|on\s+)?([^.·\n()]+?)(?:\s*\(|[.·\n]|$)/i.exec(text)?.[1]?.trim();
  return new QuotaError(text.trim().slice(0, 300), resets || undefined);
}
