export type InvoiceLifecycleState =
  | "RECEIVED"
  | "VALIDATED"
  | "EVALUATED"
  | "REJECTED"
  | "ARCHIVED";

export type InvoiceLifecycleEvent =
  | "VALIDATE"
  | "EVALUATE"
  | "REJECT"
  | "ARCHIVE";

const INVOICE_TRANSITIONS: Readonly<
  Record<InvoiceLifecycleState, Partial<Record<InvoiceLifecycleEvent, InvoiceLifecycleState>>>
> = Object.freeze({
  RECEIVED: { VALIDATE: "VALIDATED", REJECT: "REJECTED" },
  VALIDATED: { EVALUATE: "EVALUATED", REJECT: "REJECTED" },
  EVALUATED: { ARCHIVE: "ARCHIVED" },
  REJECTED: { ARCHIVE: "ARCHIVED" },
  ARCHIVED: {},
});

export function transitionInvoiceLifecycle(
  current: InvoiceLifecycleState,
  event: InvoiceLifecycleEvent,
): InvoiceLifecycleState {
  const next = INVOICE_TRANSITIONS[current][event];
  if (!next) {
    throw new Error(`Invoice lifecycle cannot apply ${event} while ${current}.`);
  }
  return next;
}
