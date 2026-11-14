/**
 * The data model, transcribed from spec §6–§7.
 *
 * Two conventions run through every type here and are worth stating once:
 *
 *  - **Amounts are integer paisa and always positive.** Direction lives in its
 *    own field (§2.1, §6). An expense is not a negative number; it is a
 *    positive number with `direction: 'out'`.
 *  - **Balances are never stored.** `Account.openingBalance` is the single
 *    exception and the only balance in the database; everything else is derived
 *    from the ledger (§2.2). Fields marked DERIVED below are caches, safe to
 *    throw away and rebuild.
 */

import type { Paisa } from './money.ts';
import type { DayKey, IsoInstant, MonthKey } from './time.ts';

// ─── Shared ──────────────────────────────────────────────────────────────────

/** How a record came to exist. Shown on every AI-written row and in the audit log (§2.4). */
export type RecordSource =
  | 'manual'
  | 'ai_chat'
  | 'ai_omnibox'
  | 'ai_voice'
  | 'ai_receipt'
  | 'notification'
  | 'recurring'
  | 'import';

/** Sources the user did not type by hand — these get a receipt card and an audit entry. */
export const AI_SOURCES: readonly RecordSource[] = ['ai_chat', 'ai_omnibox', 'ai_voice', 'ai_receipt'];

export type ReviewState = 'confirmed' | 'needs_review' | 'rejected';

/**
 * Fields carried by every record (§6).
 *
 * `deletedAt` is a tombstone, not a deletion: synced data is never hard-deleted
 * (§5), because a hard delete on one device cannot be distinguished from a
 * record that device has not seen yet.
 */
export type BaseRecord = {
  id: string;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
  deletedAt?: IsoInstant;
  source: RecordSource;
  /** 0–1, present on AI-created records only (§6). */
  confidence?: number;
};

// ─── Providers (§8) ──────────────────────────────────────────────────────────

export type ProviderKey =
  | 'bkash'
  | 'nagad'
  | 'rocket'
  | 'upay'
  | 'tap'
  | 'mcash'
  | 'dbbl'
  | 'citybank'
  | 'ebl'
  | 'brac'
  | 'ibbl'
  | 'scb'
  | 'mtb'
  | 'ucb'
  | 'sebl'
  | 'pubali'
  | 'visa'
  | 'mastercard'
  | 'amex'
  /** §8: "Users must be able to add a provider not on this list." */
  | (string & {});

export type ProviderKind = 'mfs' | 'bank' | 'network' | 'digital';

export type Provider = {
  key: ProviderKey;
  label: string;
  kind: ProviderKind;
  /** Lowercased strings that identify this provider in free text or an account name. */
  aliases: readonly string[];
  color: string;
  icon: string;
  /** False for user-added providers, so the seeded set can be updated without clobbering them. */
  isSeed: boolean;
};

// ─── Accounts ────────────────────────────────────────────────────────────────

export type AccountKind = 'mfs' | 'bank' | 'cash' | 'credit_card' | 'savings' | 'investment' | 'digital' | 'other';

/**
 * Card networks, for offer eligibility.
 *
 * This matters because a City Bank offer is routinely an *Amex* offer — City
 * Bank is the sole American Express issuer in Bangladesh — and a City Bank Visa
 * debit card is not eligible for it. Treating "City Bank" as one payment method
 * is the mistake the whole payment advisor exists to avoid.
 */
export type CardNetwork = 'amex' | 'visa' | 'mastercard' | 'unionpay' | 'qcash' | 'other';

export type Account = BaseRecord & {
  name: string;
  kind: AccountKind;
  provider?: ProviderKey;
  /** The ONLY balance ever stored (§7). Everything else is derived. */
  openingBalance: Paisa;
  currency: string;
  includeInNetWorth: boolean;
  excludeFromTotalBalance?: boolean;
  // Credit cards only:
  creditLimit?: Paisa;
  statementDay?: number; // 1–28
  dueDay?: number; // 1–28
  interestRate?: number; // annual %
  // ── Card identity, for offer eligibility ────────────────────────────────────
  // Payment methods *are* accounts. A card is not a separate entity: modelling
  // it as one would fork the balance, the ledger and the sync story for no gain,
  // and a recommendation could not become a transaction on the thing recommended.
  cardNetwork?: CardNetwork;
  /** Key into {@link CARD_CATALOGUE}, e.g. `citybank_amex_blue`. */
  cardProductKey?: string;
  /** Last four digits only. The full number is never asked for and never stored. */
  cardLast4?: string;
  color: string;
  icon: string;
  sortOrder: number;
  archived: boolean;
};

// ─── Categories ──────────────────────────────────────────────────────────────

export type CategoryType = 'income' | 'expense' | 'transfer';

/**
 * Drives every piece of advice in §13. "Essential vs discretionary" is the
 * split the advisory engine leans on hardest, so a miscategorised necessity is
 * a wrong recommendation, not just a wrong colour.
 */
export type Necessity = 'essential' | 'discretionary' | 'savings' | 'debt' | 'neutral';

export type Category = BaseRecord & {
  name: string;
  nameBn?: string;
  /** Two levels maximum: group → category. */
  parentId?: string;
  type: CategoryType;
  necessity: Necessity;
  icon: string;
  color: string;
  /** System categories can be hidden but never deleted. */
  isSystem: boolean;
  archived: boolean;
  sortOrder: number;
  /**
   * Whether this category sits in the "Most used" half of a picker.
   *
   * `undefined` means "no opinion" and falls back to the built-in shortlist, so
   * a fresh install behaves exactly as before. Setting it either way is a
   * deliberate user choice — which is why it is tri-state rather than a plain
   * boolean: promoting Hobbies and demoting Groceries are both things someone
   * may want, and a two-state flag cannot express the second.
   */
  pinned?: boolean;
};

// ─── Merchants ───────────────────────────────────────────────────────────────

/** The app's memory of places — this is what makes §18.5 (correct once, learned forever) work. */
export type Merchant = BaseRecord & {
  displayName: string;
  aliases: string[];
  categoryId: string;
  defaultAccountId?: string;
  visitCount: number;
  /** DERIVED cache. Rebuildable from the ledger. */
  totalSpent: Paisa;
  firstSeenAt: IsoInstant;
  lastSeenAt: IsoInstant;
  offerKeys: string[];
  isSubscription?: boolean;
};

// ─── Transactions ────────────────────────────────────────────────────────────

export type Direction = 'in' | 'out';

export type Transaction = BaseRecord & {
  accountId: string;
  /** Paisa, ALWAYS positive. The sign lives in `direction`. */
  amount: Paisa;
  direction: Direction;
  /** When the money moved — not when it was entered. */
  occurredAt: IsoInstant;
  description: string;
  merchantId?: string;
  categoryId: string;
  subcategoryId?: string;
  tags: string[];
  note?: string;
  attachments?: string[];
  /**
   * The other leg of a transfer. Both legs point at each other, which is how
   * §10.2.5 avoids booking an own-account transfer as income plus expense.
   */
  transferPeerId?: string;
  excludeFromBudget?: boolean;
  excludeFromReports?: boolean;
  isAdjustment?: boolean;
  recurringRuleId?: string;
  personEntryId?: string;
  reviewState: ReviewState;
};

// ─── People (§10.3, §14.6) ───────────────────────────────────────────────────

export type Person = BaseRecord & {
  displayName: string;
  aliases: string[];
  phone?: string;
  avatarColor: string;
  /** DERIVED. Positive means they owe you. */
  netBalance: Paisa;
  lastActivityAt: IsoInstant;
  archived: boolean;
  /**
   * Net opposite debts automatically for this person (§14.6).
   *
   * When on, borrowing from someone who owes you is booked as them repaying
   * you, not as a second debt — so the two never sit open at once.
   */
  autoSettle?: boolean;
};

export type PersonEntryKind = 'lent' | 'borrowed' | 'repaid_to_me' | 'repaid_by_me';
export type PersonEntryStatus = 'open' | 'partially_settled' | 'settled';

export type PersonEntry = BaseRecord & {
  personId: string;
  amount: Paisa;
  kind: PersonEntryKind;
  occurredAt: IsoInstant;
  note?: string;
  /** Which wallet the cash actually left or entered, when one was named. */
  accountId?: string;
  /** Set when this also moved real money — the second half of the dual booking in §10.3. */
  linkedTransactionId?: string;
  settledAgainst?: string[];
  status: PersonEntryStatus;
  splitGroupId?: string;
  /** A bill split (web or phone): the split's id, its name and the whole bill. */
  splitId?: string;
  splitTitle?: string;
  splitTotal?: Paisa;
  dueDate?: IsoInstant;
};

// ─── Budget plans ────────────────────────────────────────────────────────────

/**
 * A budget: a spending limit for one period that repeats. It can cover a few
 * categories (or all spending), only some wallets, a month, a week or one
 * custom date range. `single` budgets are one bill a period (house rent): they
 * show paid / not paid, never a daily allowance.
 */
export type BudgetPlan = BaseRecord & {
  name: string;
  icon: string;
  color: string;
  /** 'all' = every expense; 'categories' = only `categoryIds` (a group id covers its children). */
  scope: 'all' | 'categories';
  categoryIds: string[];
  /** Empty = spending from any wallet counts. */
  accountIds: string[];
  period: 'monthly' | 'weekly' | 'custom';
  /** For 'custom': the inclusive day range. */
  customStart?: DayKey;
  customEnd?: DayKey;
  limit: Paisa;
  /** A different limit for one period, keyed by the period's first day (YYYY-MM-DD). */
  overrides?: Record<string, Paisa>;
  /** Unspent money (or overspend) moves into the next period. */
  rollover: boolean;
  /** 'daily' shows pace and a daily allowance; 'single' is a once-a-period payment. */
  mode: 'daily' | 'single';
  /** Percent thresholds that notify, e.g. [80, 100]. */
  alerts: number[];
  archived: boolean;
  /** Hidden from the Budgets list (still counted in the totals). */
  hidden?: boolean;
  /** First day the budget applies (YYYY-MM-DD); missing = the day it was created. */
  startsOn?: DayKey;
  /** Single payments: the day of the month it must be paid by (1–31; a short month uses its last day). */
  dueDay?: number;
  /** Remind this many days before the due day (1–3). Missing = 2. */
  remindDays?: number;
  sortOrder: number;
  note?: string;
};

// ─── Recurring ───────────────────────────────────────────────────────────────

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

export type RecurringRule = BaseRecord & {
  name: string;
  templateTx: Partial<Transaction>;
  cadence: Cadence;
  dayOfMonth?: number;
  dayOfWeek?: number;
  rrule?: string;
  nextRunAt: IsoInstant;
  endsAt?: IsoInstant;
  /** True books it silently; false raises a prompt. */
  autoPost: boolean;
  detectedByAI: boolean;
  /** Previous amount, so a subscription price rise can be spotted (§13.3). */
  lastAmount?: Paisa;
  active: boolean;
};

// ─── Loans & EMIs (debts) ────────────────────────────────────────────────────

export type DebtKind = 'bank' | 'personal' | 'credit_card' | 'device' | 'vehicle' | 'home' | 'education' | 'informal' | 'other';

/**
 * A loan paid back in instalments (EMIs). Everything about where it stands —
 * outstanding, instalments paid, next due day, overdue — is worked out from
 * its payments by `domain/debts.ts`, never stored.
 */
export type Debt = BaseRecord & {
  name: string;
  kind: DebtKind;
  lender?: string;
  /** The user's own grouping ("Bank", "Phone EMIs"). */
  group?: string;
  /** Amount borrowed. */
  principal: Paisa;
  /** Annual %, 0 for interest-free. */
  interestRate: number;
  /** One instalment. */
  emi: Paisa;
  /** Number of instalments. */
  tenure: number;
  /** Due day of instalment #1 (YYYY-MM-DD); the rest fall on the same day each month. */
  firstDue: DayKey;
  /** Instalments paid before the loan was added here. */
  paidBefore: number;
  /** Wallet the EMI is paid from. */
  accountId?: string;
  /** Record the EMI by itself on its due day. */
  autoPay: boolean;
  /** Remind this many days before a due day (0 = no reminder). */
  remindDays: number;
  /** Charged per missed instalment, for the overdue figure. */
  lateFee?: Paisa;
  /** Count the outstanding in net worth (off when a card account already carries it). Missing = on. */
  inNetWorth?: boolean;
  color: string;
  note?: string;
  hidden?: boolean;
  /** Settled or closed early. */
  closed: boolean;
  sortOrder: number;
  /**
   * A credit card this loan follows: every expense on that card after
   * `cardSince` adds to what the loan owes (a refund on it takes off).
   */
  cardAccountId?: string;
  cardSince?: IsoInstant;
};

/** charge = spending on the linked card; never stored — worked out from the card's transactions. */
export type DebtPaymentKind = 'emi' | 'extra' | 'fee' | 'charge';

export type DebtPayment = BaseRecord & {
  debtId: string;
  amount: Paisa;
  paidAt: IsoInstant;
  /** emi = an instalment; extra = prepayment towards principal; fee = late fee. */
  kind: DebtPaymentKind;
  /** Which instalment an EMI pays. */
  instalment?: number;
  accountId?: string;
  /** The spending entry that moved the money (deleted with the payment). */
  transactionId?: string;
  /** Recorded by auto-pay. */
  auto?: boolean;
  note?: string;
};

// ─── Goals (§14.5) ───────────────────────────────────────────────────────────

export type Goal = BaseRecord & {
  name: string;
  target: Paisa;
  /** DERIVED from contributions. */
  saved: Paisa;
  targetDate?: IsoInstant;
  linkedAccountId?: string;
  autoContribution?: Paisa;
  /**
   * Auto-save: `percent` of every salary (or any income) recorded towards the
   * goal, for income recorded after `since`. Run by both apps with fixed ids.
   */
  autoRule?: { percent: number; trigger: 'salary' | 'income'; since: IsoInstant } | null;
  priority: number;
  icon: string;
  color: string;
  achieved: boolean;
};

export type GoalContribution = BaseRecord & {
  goalId: string;
  amount: Paisa;
  contributedAt: IsoInstant;
  transactionId?: string;
};

// ─── Investments (§14.7) ─────────────────────────────────────────────────────

export type InvestmentKind =
  | 'stocks'
  | 'mutual_fund'
  | 'dps'
  | 'fdr'
  | 'sanchayapatra'
  | 'gold'
  | 'crypto'
  | 'property'
  | 'business'
  | 'other';

export type Investment = BaseRecord & {
  name: string;
  kind: InvestmentKind;
  /** Cost basis. */
  invested: Paisa;
  currentValue: Paisa;
  lastValuedAt: IsoInstant;
  maturityDate?: IsoInstant;
  expectedReturn?: number; // annual %
  /** The day it was opened (DPS, FDR…), for how far along it is; falls back to when it was added. */
  startDate?: DayKey;
  /** What it pays out at maturity, when the certificate says so. */
  maturityAmount?: Paisa;
  note?: string;
};

// ─── Offers (§11) ────────────────────────────────────────────────────────────

/**
 * PROVISIONAL. The spec references `OfferCategoryKey` but does not enumerate it.
 * This starter set covers the merchant types Bangladeshi MFS promotions
 * actually target; it is due for confirmation before Phase 7.
 */
export type OfferCategoryKey =
  | 'grocery'
  | 'restaurant'
  | 'food_delivery'
  | 'fashion'
  | 'electronics'
  | 'pharmacy'
  | 'health'
  | 'fuel'
  | 'ride_share'
  | 'travel'
  | 'utility_bill'
  | 'mobile_recharge'
  | 'education'
  | 'entertainment'
  | 'ecommerce'
  | 'other';

/** How a payment is actually presented at the till. Offers are routinely rail-specific. */
export type PaymentRail = 'qr' | 'pos' | 'online' | 'app' | 'atm' | 'bill_pay' | 'any';

/**
 * Where an offer came from and how much it should be trusted.
 *
 * §2.8 forbids presenting a fabricated promotion as real, and offers go stale
 * faster than almost any other financial data — so provenance is a first-class
 * field, not a footnote. Every offer the app shows can name its source and the
 * moment that source was last read.
 */
export type OfferSourceRef = {
  /** Stable adapter key, e.g. `bkash_offer_finder`, `citybank_web`, `manual`, `sample`. */
  sourceKey: string;
  sourceName: string;
  sourceUrl?: string;
  /** When the ingestion run that produced this record read the source. */
  collectedAt?: IsoInstant;
  /** When the *source* last said it changed, where it says so. */
  sourceUpdatedAt?: IsoInstant;
};

/**
 * Who and what an offer actually applies to (§14).
 *
 * Every field is optional and every absent field means **unconstrained**, not
 * "unknown and probably fine". The engine only ever narrows on what is stated.
 */
export type OfferEligibility = {
  /** Exact card products, e.g. `['citybank_amex_platinum', 'citybank_amex_gold']`. */
  cardProductKeys?: string[];
  networks?: CardNetwork[];
  rails?: PaymentRail[];
  newUsersOnly?: boolean;
  existingUsersOnly?: boolean;
  /** A targeted campaign. Never recommended as certain — only ever "you may be eligible". */
  selectedUsersOnly?: boolean;
  cities?: string[];
  branches?: string[];
  onlineOnly?: boolean;
  offlineOnly?: boolean;
  promoCode?: string;
};

/** Usage caps (§3). All optional; absent means the source did not state one. */
export type OfferLimits = {
  /** Above this the offer stops applying entirely — rarer than a benefit cap, but real. */
  maxSpend?: Paisa;
  usesAllowed?: number;
  usesRemaining?: number;
  perTransactionBenefit?: Paisa;
  monthlyBenefit?: Paisa;
  campaignBenefit?: Paisa;
  frequency?: 'per_transaction' | 'daily' | 'weekly' | 'monthly' | 'campaign';
};

/** EMI terms attached to an offer (§22). */
export type OfferEmi = {
  /** Tenures in months the merchant/bank supports under this offer. */
  tenures: number[];
  /** True for a genuine 0% plan. Everything else prices at the card's EMI rate. */
  interestFree: boolean;
  /** Annual flat rate when not interest-free. Falls back to the card product's rate. */
  flatAnnualRate?: number;
  /** Processing fee charged to convert to EMI, in paisa. */
  processingFee?: Paisa;
};

/**
 * §15 — how much to trust this row today.
 *
 * `sample` is its own state rather than a flavour of `needs_verification`,
 * because a sample is not a weak claim about a real promotion; it is not a claim
 * about a real promotion at all.
 */
export type OfferVerification = 'verified' | 'needs_verification' | 'expired' | 'sample';

export type Offer = BaseRecord & {
  provider: ProviderKey;
  instrument: 'mfs' | 'credit_card' | 'debit_card' | 'card' | 'any';
  category: OfferCategoryKey;
  subcategory?: string;
  /** `discount` means pay less now; `cashback` means the full amount leaves now (§11.5). */
  mode: 'discount' | 'cashback';
  benefitType: 'percent' | 'flat' | 'bogo';
  /** Percent (0–100) or paisa, depending on `benefitType`. */
  value: number;
  /** Paisa. 0 means uncapped. */
  maxBenefit: Paisa;
  /** Paisa. 0 means no minimum. */
  minSpend: Paisa;
  title: string;
  description?: string;
  merchants: string[];
  payWith: string;
  validFrom?: IsoInstant;
  validTill?: IsoInstant;
  terms?: string;
  /** §2.8: seeded templates are visibly labelled as samples, never as verified promotions. */
  isSample: boolean;

  // ── Structured detail (§3), all optional so older rows stay valid ───────────
  eligibility?: OfferEligibility;
  limits?: OfferLimits;
  emi?: OfferEmi;
  sourceRef?: OfferSourceRef;
  lastVerifiedAt?: IsoInstant;
  /**
   * Whether this can be combined with another benefit (§13).
   *
   * Deliberately tri-state: `undefined` means the terms did not say, and the
   * engine treats that as "do not stack". Assuming combinability without
   * evidence is how a recommendation becomes a wrong final price.
   */
  stackable?: boolean;
  /** Stable identity across ingestion runs, so a re-scrape updates rather than duplicates. */
  dedupeKey?: string;
  /**
   * The published figure is a ceiling, not a promise — "up to ৳200 off".
   *
   * The engine still ranks on it, because it is the only number available, but
   * it is labelled an estimate so the user is never told they *will* save an
   * amount the terms only said they *might*.
   */
  benefitIsUpperBound?: boolean;
};

// ─── Realized savings (§19, §20) ─────────────────────────────────────────────

/**
 * One recorded instance of the advisor being right, or wrong.
 *
 * Predicted and actual are both kept. The gap is the only honest measure of
 * whether the engine is worth listening to, and §20 asks the system to learn
 * from it rather than quietly reporting its own predictions back as results.
 */
export type RealizedSaving = BaseRecord & {
  kind: 'offer' | 'fee_route' | 'subscription' | 'budget';
  occurredAt: IsoInstant;
  /** The spend the saving was measured against. */
  billAmount: Paisa;
  predictedSaving: Paisa;
  /** What the user confirmed they actually saved. Never inferred. */
  actualSaving: Paisa;
  offerId?: string;
  transactionId?: string;
  accountId?: string;
  merchant?: string;
  categoryKey?: OfferCategoryKey;
  note?: string;
};

// ─── AI access control (§15, §20 of the MCP brief) ───────────────────────────

/**
 * What a connected assistant may do.
 *
 * Lives here rather than beside the tool table because both the domain layer
 * (connections, audit) and the AI layer (tool classification) need it, and the
 * domain layer may not import from `src/ai`.
 */
export type Scope = 'read' | 'write' | 'sensitive';

/**
 * An external AI assistant paired with this device over MCP.
 *
 * The token is stored as a **hash only**. A revoked connection keeps its row so
 * its audit history stays attributable — "what did the thing I removed last
 * week actually do?" is the question a revocation list exists to answer.
 */
export type McpConnection = BaseRecord & {
  /** What the user calls it: "Claude Desktop", "ChatGPT". */
  clientName: string;
  scopes: Scope[];
  /** SHA-256 of the pairing token. The token itself is shown once and never stored. */
  tokenHash: string;
  pairedAt: IsoInstant;
  lastSeenAt?: IsoInstant;
  /** Set on revocation. Revoked connections are refused and kept. */
  revokedAt?: IsoInstant;
  callCount: number;
  /** Calls allowed per hour. Enforced on the app side, where the data is. */
  hourlyLimit: number;
};

// ─── Subscriptions ──────────────────────────────────────────────────────────

export type SubscriptionCadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type Subscription = BaseRecord & {
  name: string;
  amount: Paisa;
  cadence: SubscriptionCadence;
  categoryId: string;
  accountId?: string;
  nextBillingDate: IsoInstant;
  icon: string;
  color: string;
  active: boolean;
  cancelReminder?: IsoInstant;
  note?: string;
};

// ─── Attachments ─────────────────────────────────────────────────────────────

/**
 * A photo kept with a transaction — a receipt, a cash memo, a warranty card.
 * Stored as a small JPEG in base64 so it syncs like any other record (a
 * Firestore document holds at most 1 MiB; photos are shrunk well under that).
 */
/**
 * A correction the app learned (see `domain/learned-rules.ts`): entries that
 * match `provider`, `phrase` and `direction` get the fix.
 */
export type LearnedRule = BaseRecord & {
  /** Where it was learned: a message (SMS or wallet notification), the chat, or an edit. */
  origin: 'message' | 'chat' | 'edit';
  /** The wallet provider it applies to ("bkash"); any when missing. */
  provider?: string;
  /** Words in the message or description ("shwapno", "01711xxxxxx"). */
  phrase: string;
  /** Only for money in, or out, as it was read; either when missing. */
  direction?: 'in' | 'out';
  categoryId?: string;
  accountId?: string;
  description?: string;
  /** Book it the other way round. */
  setDirection?: 'in' | 'out';
  /** Messages like this are not transactions: skip them. */
  ignore?: boolean;
  /** Times it fixed an entry. */
  hits: number;
  lastUsedAt?: IsoInstant;
};

/** A payoff plan the user applied: the order, the extra a month and which loans. */
export type DebtPlanSetting = {
  strategy: 'avalanche' | 'snowball' | 'yours';
  extra: Paisa;
  includeIds?: string[];
  appliedAt: IsoInstant;
  /** Off keeps the plan but shows your own order (missing = on). */
  active?: boolean;
  /** The loan order before the plan, put back when it is turned off. */
  previousOrder?: string[];
};

/** Kinds of expected income, for the icon and grouping. */
export type IncomeKind = 'salary' | 'freelance' | 'project' | 'bonus' | 'other';

/**
 * Income you expect (Income Plan): a salary each month, a project payment on
 * a date. What actually came in is read from income transactions; this record
 * is only the expectation, so the two can be compared.
 */
export type IncomePlan = BaseRecord & {
  name: string;
  kind: IncomeKind;
  /** The usual amount. */
  amount: Paisa;
  /** 'monthly' repeats; 'once' is expected on `date` only. */
  cadence: 'monthly' | 'once';
  /** Monthly: the day of the month it usually arrives (1–31). */
  day?: number;
  /** Once: the day it is expected. */
  date?: DayKey;
  /** Monthly: the first month it applies ("2026-10"), and the last if it ends. */
  fromMonth?: string;
  untilMonth?: string;
  /** Who pays: an employer, a client. */
  payer?: string;
  /** Where it usually lands, and its category — used by "Mark received". */
  accountId?: string;
  categoryId?: string;
  /** Words that pick out its income entries (comma separated); the name when empty. */
  match?: string;
  note?: string;
  sortOrder: number;
  /** One month different: {"2026-11": 7000000}; 0 skips that month. */
  overrides?: Record<string, Paisa>;
  /** Monthly: only in these months (1–12), e.g. an Eid bonus. Every month when empty. */
  months?: number[];
  /** 'average': expect what came in on average over the last three months (freelance); 'fixed' (default): `amount`. */
  estimate?: 'fixed' | 'average';
};

export type Attachment = BaseRecord & {
  transactionId: string;
  /** "image/jpeg". */
  mime: string;
  /** Base64, no "data:" prefix. */
  data: string;
  width: number;
  height: number;
  /** Bytes of the decoded image. */
  size: number;
  name?: string;
};

// ─── Tasks (§16.4) ───────────────────────────────────────────────────────────

/** One line of a checklist inside a task. Steps are not tasks — they have no dates. */
export type TaskStep = {
  id: string;
  title: string;
  done: boolean;
};

export type TaskRepeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export type Task = BaseRecord & {
  title: string;
  done: boolean;
  completedAt?: IsoInstant;
  /** The star. A preference, deliberately separate from the due date. */
  important: boolean;
  /**
   * The day this was added to "My Day", as a day key.
   *
   * A date rather than a boolean so that today's plan expires by itself
   * overnight — see `src/domain/tasks.ts`.
   */
  myDay?: DayKey;
  dueDate?: DayKey;
  remindAt?: IsoInstant;
  repeat: TaskRepeat;
  steps: TaskStep[];
  note?: string;
  /** Hand-ordering within a list, so dragging a row means something. */
  sortOrder: number;
  /** What this task is expected to cost, when it is a payment. */
  amount?: Paisa;
  categoryId?: string;
};

// ─── Wishlist ────────────────────────────────────────────────────────────────

export type WishlistItem = BaseRecord & {
  name: string;
  targetPrice: Paisa;
  url?: string;
  icon: string;
  priority: number;
  purchased: boolean;
  purchasedAt?: IsoInstant;
  note?: string;
};

// ─── Savings Challenges ──────────────────────────────────────────────────────

export type ChallengeType = 'no_spend' | 'daily_limit' | 'save_target';

export type Challenge = BaseRecord & {
  name: string;
  type: ChallengeType;
  /** For daily_limit: max per day in paisa. For save_target: total target in paisa. */
  target: Paisa;
  startDate: IsoInstant;
  endDate: IsoInstant;
  active: boolean;
  completed: boolean;
};

// ─── Achievements & Streaks ──────────────────────────────────────────────────

export type Achievement = BaseRecord & {
  key: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: IsoInstant;
};

// ─── Health Score History ────────────────────────────────────────────────────

export type HealthSnapshot = BaseRecord & {
  month: MonthKey;
  score: number;
  components: Record<string, number>;
};

// ─── Settings (§7) ───────────────────────────────────────────────────────────

export type ThemeName = 'system' | 'dark' | 'light' | 'dark_gray' | 'amoled' | 'glass';

/** The Glass theme's options — the Android app's, so the two can look alike. */
export type GlassSettings = {
  /** Backdrop key: aurora, sunset, ocean, emerald, rose, midnight, graphite (no colour) or pearl (light). */
  backdrop: string;
  /** 0–100: how strongly the panels blur what is behind them. */
  blur: number;
  /** 0–100: how solid the panels are. */
  opacity: number;
  /** Panel tint key: white (plain glass), violet, blue, emerald, rose, amber. */
  tint: string;
};
export type LocaleCode = 'en' | 'bn';

/** Which AI vendor to talk to. */
export type AiProviderId = 'anthropic' | 'google' | 'xai';

/**
 * How the app reaches the model.
 *
 * `gateway` keeps the key on a server the developer controls, which is what
 * §12.1 asks for and the right answer for a published build. `direct` is
 * bring-your-own-key: the user's *own* key, on their *own* device, talking to
 * their *own* account. That is a different risk from shipping one key to every
 * user, and it is the only way to use this app without running a server — so
 * both are supported and the UI states the trade plainly.
 */
export type AiMode = 'off' | 'gateway' | 'direct';

export type AiSettings = {
  enabled: boolean;
  mode: AiMode;
  provider: AiProviderId;
  /**
   * BYOK only. Held in IndexedDB, never in localStorage, never written to the
   * sync outbox, and never logged. Cleared when the mode leaves `direct`.
   */
  apiKey?: string;
  /** BYOK third-party proxy URL if provided. */
  baseUrl?: string;
  /** Gateway mode only — the base URL of the server holding the key. */
  gatewayUrl?: string;
  /** Overrides the provider's default model when set. */
  model?: string;
  /** Above this confidence a capture is applied without asking (§10.2.10). */
  autoBookThreshold: number;
  alwaysConfirm: boolean;
  chatEnabled: boolean;
  receiptScanEnabled: boolean;
  notificationCaptureEnabled: boolean;
  weeklyBriefingEnabled: boolean;
  monthlyTokenCap: number;
  /** Rolling estimate of what has been spent this month, for the usage display. */
  usageThisMonth?: { month: string; inputTokens: number; outputTokens: number; costUsd: number };
};

export type PrivacySettings = {
  hideAmountsInSwitcher: boolean;
  incognitoMode: boolean;
  appLock: 'none' | 'pin' | 'biometric';
  autoLockMinutes: number;
};

export type Settings = {
  /**
   * ISO country code chosen at setup ("BD", "AE"…). Sets the currency, number
   * style and weekend, and whether Bangladesh-only features (Bangla, bKash /
   * Nagad message reading, offers) show. Missing means Bangladesh (older installs).
   */
  country?: string;
  /** Weekend days, 0 = Sunday … 6 = Saturday. Missing means Friday–Saturday. */
  weekendDays?: number[];
  currency: string;
  locale: LocaleCode;
  numberFormat: 'lakh_crore' | 'international';
  /** §15.5 offers a Bengali-numeral display toggle; it is not in the spec's Settings shape. */
  bengaliNumerals: boolean;
  timezone: string;
  theme: ThemeName;
  accentFrom: string;
  accentTo: string;
  /** 1 = calendar month; 25 = salary-cycle month (§7). */
  monthStartDay: number;
  /** Budgets: show daily pace and a per-day allowance. Off = only spent / left. Missing means on. */
  budgetDailyView?: boolean;
  /** Budgets list order: 'custom' (dragged) or 'auto' (what needs attention first). Missing = custom. */
  budgetSort?: 'custom' | 'auto';
  /** Loans list order: 'custom' (dragged) or 'auto' (overdue and due first). Missing = custom. */
  debtSort?: 'custom' | 'auto';
  /** The payoff plan applied from the planner (null = none). */
  debtPlan?: DebtPlanSetting | null;
  monthlyIncomeEstimate?: Paisa;
  ai: AiSettings;
  privacy: PrivacySettings;
  /** Wallets and cards the user actually holds, for offer matching (§11.1). */
  myProviders: ProviderKey[];
  /**
   * Where to pull the collected offer catalogue from.
   *
   * Deliberately its own setting rather than reusing the AI gateway URL. The
   * catalogue is public reference data — published promotions, read from
   * published pages, carrying nothing about any user — and requiring someone to
   * configure an AI provider in order to see live offers would gate a free
   * feature behind a paid one. It falls back to the AI gateway when that is the
   * same server, which is the common case.
   */
  offerServiceUrl?: string;
  /** Whether this window should keep a bridge open for external assistants. */
  mcpEnabled?: boolean;
  /** Where the MCP server is listening. Loopback by default; this is local-first. */
  mcpBridgeUrl?: string;
  /** Whether a signed-in user's ledger is mirrored to their account. Never required. */
  cloudSyncEnabled?: boolean;
  /** Whether to show out/in progress bars on account cards by default. */
  showAccountProgressBars?: boolean;
  /** Whether to show all accounts (including cash) as virtual cards in the My Cards widget. */
  showAllAccountsInWidget?: boolean;
  /** A see-through bottom dock instead of a solid one. */
  dockTransparent?: boolean;
  /** Options for the Glass theme. */
  glass?: GlassSettings;
  /** The phone dock's look (Settings → Dock), as on the Android app. */
  dockStyle?: 'notch' | 'modern' | 'minimal' | 'bar';
  /** Dock colour preset key ("auto" follows the theme), or "custom" with [dockHue]. */
  dockColor?: string;
  dockHue?: number;
  /** The eight tabs the dock holds, four a page (ZED AI is always in the middle). */
  dockTabs?: string[];
  /** Swipe right from the left half of the screen to open the menu (phones). */
  menuSwipe?: boolean;
  /** Where a swipe to the right may start to open the menu: the left edge, third, half (default) or anywhere. */
  menuSwipeArea?: 'edge' | 'third' | 'half' | 'anywhere';
  /** Phone text size: 0.9, 1, 1.1 or 1.2 (Settings → Appearance). */
  textScale?: number;
  /** Accounts to include in the cash allowance calculation. If empty, falls back to budget-based allowance. */
  allowanceAccountIds?: string[];
  /**
   * Today's frozen daily allowance (§14.3).
   *
   * The allowance is drawn once a day and held there — see `resolveDailyAllowance`.
   * `dayKey` is the day it was set for, so the next day's first view recomputes.
   */
  allowanceSnapshot?: { dayKey: string; amount: number };
  /** User's custom ordering of budget IDs for the Budgets screen. */
  loanOrder?: string[];
  /**
   * The date the cash allowance has to stretch to (§14.3).
   *
   * Unset means the end of the budget month. Stored as a date, not a number of
   * days, so it stays true as days pass — see `allowanceHorizon`.
   */
  allowanceUntil?: DayKey;
  /** Income Plan: the share of expected income to put aside, 0–100 (default 20). */
  incomeSavePct?: number;
  /** Suggest usual entries around their usual time (default on). */
  habitReminders?: boolean;
  /** Habits the user said to stop suggesting. */
  habitIgnored?: string[];
};
