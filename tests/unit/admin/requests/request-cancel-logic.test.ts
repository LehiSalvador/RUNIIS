import { describe, expect, test } from "vitest";
import { CANCEL_REASON_CATEGORIES, CANCEL_REASON_LABELS } from "@/lib/shared/closure";
import {
  BUYER_EMAIL_NOTICE,
  BUYER_NOTIFICATION_SHORT,
  REQUEST_CANCEL_CATEGORY_OPTIONS,
  buyerNotificationCopy,
  followUpCount,
  validateRequestCancel,
} from "@/components/admin/requests/request-cancel-logic";

describe("staff cancel of a request (P3-S: the buyer is emailed)", () => {
  test("the dialogs say, before the click, that the buyer is emailed and that no payment is handled", () => {
    expect(BUYER_EMAIL_NOTICE.email).toContain("Se enviará un correo al comprador");
    expect(BUYER_EMAIL_NOTICE.email).toContain("El texto del motivo interno no se envía");
    expect(BUYER_EMAIL_NOTICE.payments).toContain("no procesa pagos");
    expect(JSON.stringify(BUYER_EMAIL_NOTICE)).not.toMatch(/no se env[ií]a correo/i);
  });

  test("the category select offers exactly the server's closed set, with the labels the email shows", () => {
    expect(REQUEST_CANCEL_CATEGORY_OPTIONS.map((option) => option.value)).toEqual([...CANCEL_REASON_CATEGORIES]);
    for (const option of REQUEST_CANCEL_CATEGORY_OPTIONS) expect(option.label).toBe(CANCEL_REASON_LABELS[option.value]);
  });

  test("the category is required (no silent default), the internal reason is required and bounded", () => {
    expect(validateRequestCancel({ category: "", reason: "" })).toEqual({
      ok: false,
      errors: { category: "Elige la categoría: es lo que verá el comprador en su correo.", reason: "Escribe el motivo interno: queda en la auditoría." },
    });
    expect(validateRequestCancel({ category: "NOPE", reason: "ok" })).toMatchObject({ ok: false, errors: { category: expect.any(String) } });
    expect(validateRequestCancel({ category: "OTHER", reason: "x".repeat(501) })).toMatchObject({ ok: false, errors: { reason: "Máximo 500 caracteres." } });
    expect(validateRequestCancel({ category: "ADMINISTRATIVE", reason: "  Comprobante falso  " })).toEqual({ ok: true, category: "ADMINISTRATIVE", reason: "Comprobante falso" });
  });

  test("each email outcome has its own copy; suppressed and no-contact ask for a manual follow-up", () => {
    expect(buyerNotificationCopy({ status: "queued", follow_up_task_id: null })).toMatchObject({ tone: "success", followUp: false, title: "Correo en cola" });
    expect(buyerNotificationCopy({ status: "suppressed", follow_up_task_id: "t" })).toMatchObject({ tone: "warning", followUp: true, title: "El correo no se enviará" });
    expect(buyerNotificationCopy({ status: "no_contact", follow_up_task_id: "t" })).toMatchObject({ tone: "warning", followUp: true, title: "No hay correo al que avisar" });
    const unknown = buyerNotificationCopy({ status: "unknown", follow_up_task_id: null });
    expect(unknown).toMatchObject({ tone: "info", followUp: false });
    expect(unknown.message).toContain("La cancelación sí se aplicó");
    for (const status of ["queued", "suppressed", "no_contact", "unknown"] as const) expect(BUYER_NOTIFICATION_SHORT[status]).toBeTruthy();
  });

  test("a bulk result counts the buyers that need a follow-up, ignoring rows without an outcome", () => {
    expect(
      followUpCount([
        { notification: { status: "queued", follow_up_task_id: null } },
        { notification: { status: "suppressed", follow_up_task_id: "a" } },
        { notification: { status: "no_contact", follow_up_task_id: "b" } },
        { notification: { status: "unknown", follow_up_task_id: null } },
        {},
      ]),
    ).toBe(2);
  });
});
