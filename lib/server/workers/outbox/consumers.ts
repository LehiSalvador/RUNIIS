import "server-only";

export type OutboxConsumer = {
  /** `public.<rpc>(p_outbox_event_id uuid)` — SYSTEM-only, called with the claimed event's id. */
  rpc: string;
  /** Master §147-148: retries exhausted → ESCALATED + AdminTask instead of retrying forever. */
  maxAttempts: number;
};

export type OutboxConsumerRegistry = Readonly<Record<string, OutboxConsumer>>;

/**
 * Outbox event types the dispatcher claims and how to process them. Only registered types are ever
 * claimed (`claim_outbox_events` takes the type list), so an event type with no consumer here simply
 * sits PENDING until a task registers one — it is never silently dropped or mis-claimed.
 *
 * Other tasks append their own `event_type -> {rpc, maxAttempts}` entries here as they add consumers
 * (do not remove or rename T35's own entries below).
 */
export const outboxConsumerRegistry: OutboxConsumerRegistry = {
  RegistrationConfirmed: { rpc: "enqueue_registration_confirmed_messages", maxAttempts: 10 },
  EditionRegistrationOpened: { rpc: "enqueue_edition_event_messages", maxAttempts: 8 },
  EditionPostponed: { rpc: "enqueue_edition_event_messages", maxAttempts: 8 },
  EditionRescheduled: { rpc: "enqueue_edition_event_messages", maxAttempts: 8 },
  EditionCanceled: { rpc: "enqueue_edition_event_messages", maxAttempts: 8 },
  // P3-C OWN-04: the participant (the buyer for a Guest) is always emailed when staff cancel a confirmed registration.
  RegistrationCanceled: { rpc: "enqueue_registration_canceled_messages", maxAttempts: 10 },
  // P3-S (UX J2 step 4): the buyer is emailed when STAFF cancel a pending request (never on the buyer's own cancel or the worker's expiry).
  RegistrationRequestCanceledByStaff: { rpc: "enqueue_registration_request_canceled_messages", maxAttempts: 10 },
};
