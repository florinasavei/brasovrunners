import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { PressCause } from "./domain/press-causes";

/**
 * The email press scope (the design «telling the owner about every email a staff press sends», 2026-11-03,
 * slice 1: the owner asked to know every email a press of his sends, before, after and in a list of the day).
 *
 * Every staff press that can queue an email runs its whole body inside `inEmailPress(cause, …)` — the staff
 * check, the service, the toast and the redirect — and so do the two job routes. `enqueueEmail`, the club's
 * copies and the relay read the scope at the insert (`currentEmailPress`) and stamp each row with the press's
 * `cause`, its `press_id` and, once the action has named its actor (`press.by`), `requested_by_staff_user_id`.
 * Nothing else about the row changes: the scope labels what is queued, it never decides whether or when.
 *
 * `AsyncLocalStorage`, part of Node, rather than React's per-request `cache`: the scope must follow the press
 * through its transaction and its service calls, and `email-road-request.ts` already hedges that `cache` may not
 * hold inside a Server Action. A public flow opens no scope, so its rows carry none — «de pe site» on «Emailuri
 * azi». When scopes nest the inner one wins: a drain that does the outbox job's work after a press's response
 * runs in the job's scope (`drain.ts`), never in the press's, which Next's `after()` would otherwise carry into it.
 *
 * A `redirect()` throws through `run` unchanged, and the scope ends with the press.
 */

/** One press as the rows see it: the scope's id, its cause and, once named, the staff member who pressed. */
export type EmailPress = {
  readonly id: string;
  readonly cause: PressCause;
  readonly actorStaffUserId: string | null;
};

/** What a press's body holds: the scope's id and cause, and `by` to name the actor once it has checked who it is. */
export type EmailPressHandle = {
  readonly id: string;
  readonly cause: PressCause;
  /** The staff member the action asserted, stamped as the requester of every row queued after this call. */
  by(actorStaffUserId: string): void;
};

type Store = { id: string; cause: PressCause; actorStaffUserId: string | null };

const storage = new AsyncLocalStorage<Store>();

/**
 * Run `work` as one press: a fresh id, the cause, no actor until `press.by(actor.id)`. Returns what `work`
 * returns and throws what it throws — a refusal, a `redirect()` — unchanged.
 */
export function inEmailPress<T>(cause: PressCause, work: (press: EmailPressHandle) => Promise<T>): Promise<T> {
  const store: Store = { id: randomUUID(), cause, actorStaffUserId: null };
  const handle: EmailPressHandle = {
    id: store.id,
    cause,
    by(actorStaffUserId: string) {
      store.actorStaffUserId = actorStaffUserId;
    },
  };
  return storage.run(store, () => work(handle));
}

/** The press this code runs inside, or `undefined` outside every scope — a public flow, a script, a test. */
export function currentEmailPress(): EmailPress | undefined {
  const store = storage.getStore();
  return store ? { id: store.id, cause: store.cause, actorStaffUserId: store.actorStaffUserId } : undefined;
}

/**
 * The three columns an outbox insert takes from the scope: the cause, the press's id, and the requester — the one
 * the caller passed wins (a resend, the newsletter, a notice already name theirs), else the press's actor.
 */
export function pressStamp(requestedByStaffUserId?: string | null): {
  cause: PressCause | null;
  pressId: string | null;
  requestedByStaffUserId: string | null;
} {
  const press = currentEmailPress();
  return {
    cause: press?.cause ?? null,
    pressId: press?.id ?? null,
    requestedByStaffUserId: requestedByStaffUserId ?? press?.actorStaffUserId ?? null,
  };
}
