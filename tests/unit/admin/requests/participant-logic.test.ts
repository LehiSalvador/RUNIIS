import { describe, expect, test } from "vitest";
import { CANCEL_NOTIFICATION_STATUSES, CANCEL_REASON_LABELS } from "@/lib/shared/closure";
import {
  CANCEL_CATEGORY_OPTIONS,
  attendanceHref,
  attendanceText,
  canCancelRegistration,
  canChangeModality,
  cancelFailureCopy,
  changeFailureCopy,
  closureBlockedCopy,
  csvFileName,
  displayName,
  distanceImpactText,
  exportQuery,
  hasContact,
  notificationCopy,
  selectableCategories,
  targetModalities,
  validateCancel,
  validateChange,
  validateExportReason,
  type CategoryOption,
  type ModalityOption,
} from "@/components/admin/participants/participant-logic";

const EDITION = "5a000000-0000-4000-8000-00000000000a";
const MODALITIES: ModalityOption[] = [
  { modality_id: "m10", name: "10K", status: "ACTIVE" },
  { modality_id: "m21", name: "21K", status: "ACTIVE" },
  { modality_id: "m5", name: "5K", status: "CLOSED" },
];
const CATEGORIES: CategoryOption[] = [
  { category_id: "c1", name: "Libre", assignment_mode: "USER_SELECTS", active: true, modality_ids: ["m21"] },
  { category_id: "c2", name: "Edad", assignment_mode: "SYSTEM_DERIVES", active: true, modality_ids: ["m21"] },
  { category_id: "c3", name: "Vieja", assignment_mode: "USER_SELECTS", active: false, modality_ids: ["m21"] },
];

describe("cancel registration (OWN-04)", () => {
  test("the category the participant sees is required, and the internal reason is required and bounded", () => {
    expect(validateCancel({ category: "", reason: "" })).toEqual({
      ok: false,
      errors: { category: "Elige la categoría: es lo que verá el participante en su correo.", reason: "Escribe el motivo interno: queda en la auditoría." },
    });
    expect(validateCancel({ category: "NOT_A_CATEGORY", reason: "ok" })).toMatchObject({ ok: false, errors: { category: expect.any(String) } });
    expect(validateCancel({ category: "DUPLICATE_REGISTRATION", reason: "x".repeat(501) })).toMatchObject({ ok: false, errors: { reason: "Máximo 500 caracteres." } });
    expect(validateCancel({ category: "DUPLICATE_REGISTRATION", reason: "  Se inscribió dos veces  " })).toEqual({
      ok: true,
      body: { reason: "Se inscribió dos veces", reason_category: "DUPLICATE_REGISTRATION" },
    });
  });

  test("the select offers exactly the categories the email can mention, with the wording the participant reads", () => {
    expect(CANCEL_CATEGORY_OPTIONS.map((option) => option.value)).toEqual(Object.keys(CANCEL_REASON_LABELS));
    for (const option of CANCEL_CATEGORY_OPTIONS) expect(option.label).toBe(CANCEL_REASON_LABELS[option.value]);
  });

  test("only a confirmed registration can be cancelled or moved", () => {
    expect(canCancelRegistration({ status: "CONFIRMED" })).toBe(true);
    expect(canCancelRegistration({ status: "CANCELED" })).toBe(false);
    expect(canChangeModality({ status: "CONFIRMED" }, MODALITIES, "m10")).toBe(true);
    expect(canChangeModality({ status: "CANCELED" }, MODALITIES, "m10")).toBe(false);
    expect(canChangeModality({ status: "CONFIRMED" }, [MODALITIES[0]], "m10")).toBe(false);
  });

  test("every email outcome the server can report is explained, and the ones that need a person say so", () => {
    for (const status of CANCEL_NOTIFICATION_STATUSES) expect(notificationCopy({ status, follow_up_task_id: null }, "participant").message.length).toBeGreaterThan(20);
    expect(notificationCopy({ status: "queued", follow_up_task_id: null }, "participant")).toMatchObject({ tone: "success", followUp: false });
    expect(notificationCopy({ status: "queued", follow_up_task_id: null }, "buyer").message).toContain("al comprador");
    expect(notificationCopy({ status: "suppressed", follow_up_task_id: "t" }, "participant")).toMatchObject({ tone: "warning", followUp: true, title: "El correo no se enviará" });
    expect(notificationCopy({ status: "no_contact", follow_up_task_id: "t" }, "buyer")).toMatchObject({ tone: "warning", followUp: true });
    expect(notificationCopy({ status: "unknown", follow_up_task_id: null }, "participant").message).toContain("La cancelación sí se aplicó");
  });

  test("after finalization or closure the refusal says what to reopen first", () => {
    expect(closureBlockedCopy({ code: "CLOSURE_BLOCKED", details: { reason: "attendance_finalized" } })).toMatchObject({ reopen: "finalization", title: "La asistencia ya está finalizada" });
    expect(closureBlockedCopy({ code: "CLOSURE_BLOCKED", details: { reason: "edition_closed" } })).toMatchObject({ reopen: "closure" });
    expect(closureBlockedCopy({ code: "CLOSURE_BLOCKED", details: {} })).toMatchObject({ reopen: "finalization" });
    expect(closureBlockedCopy({ code: "CONFLICT" })).toBeNull();
  });

  test("the attendance link exists only when this build has an attendance page", () => {
    expect(attendanceHref(EDITION, () => false)).toBeNull();
    expect(attendanceHref(EDITION, (route) => route === "/admin/asistencia")).toBe(`/admin/asistencia?edition_id=${EDITION}`);
    expect(attendanceHref(EDITION, () => true)).toBe(`/admin/eventos/${EDITION}/asistencia`);
  });

  test("an already-cancelled registration says to reload", () => {
    expect(cancelFailureCopy({ code: "CONFLICT", details: { reason: "invalid_transition", current: "CANCELED" } })?.title).toBe("La inscripción ya no está confirmada");
    expect(cancelFailureCopy({ code: "FORBIDDEN" })).toBeNull();
  });
});

describe("change modality", () => {
  test("targets are the other ACTIVE modalities of the Edition", () => {
    expect(targetModalities(MODALITIES, "m10").map((option) => option.modality_id)).toEqual(["m21"]);
  });

  test("only active, user-selectable categories of the target are asked for", () => {
    expect(selectableCategories(CATEGORIES, "m21").map((category) => category.category_id)).toEqual(["c1"]);
    expect(selectableCategories(CATEGORIES, "m10")).toEqual([]);
  });

  test("the form needs a different modality, a category when the target requires one, and a reason", () => {
    expect(validateChange({ modalityId: "", categoryId: "", reason: "" }, "m10", CATEGORIES)).toEqual({
      ok: false,
      errors: { modality: "Elige la modalidad nueva.", reason: "Escribe el motivo: queda en la auditoría." },
    });
    expect(validateChange({ modalityId: "m10", categoryId: "", reason: "x" }, "m10", CATEGORIES)).toMatchObject({ ok: false, errors: { modality: "Elige una modalidad distinta a la actual." } });
    expect(validateChange({ modalityId: "m21", categoryId: "", reason: "x" }, "m10", CATEGORIES)).toMatchObject({ ok: false, errors: { category: "Esta modalidad pide elegir una categoría." } });
    expect(validateChange({ modalityId: "m21", categoryId: "c1", reason: " Quiere más distancia " }, "m10", CATEGORIES)).toEqual({
      ok: true,
      body: { new_modality_id: "m21", category_id: "c1", reason: "Quiere más distancia" },
    });
    // a target without selectable categories sends no category (the server derives it)
    expect(validateChange({ modalityId: "m5", categoryId: "", reason: "x" }, "m10", CATEGORIES)).toEqual({ ok: true, body: { new_modality_id: "m5", reason: "x" } });
  });

  test("the distance impact is stated only when something changes", () => {
    expect(distanceImpactText({ from_m: 10000, to_m: 10000, from_generates_credit: true, to_generates_credit: true })).toBeNull();
    expect(distanceImpactText({ from_m: 10000, to_m: 21097, from_generates_credit: true, to_generates_credit: true })).toBe("La distancia oficial pasa de 10 km a 21.097 km.");
    expect(distanceImpactText({ from_m: 10000, to_m: null, from_generates_credit: true, to_generates_credit: false })).toBe(
      "La distancia oficial pasa de 10 km a sin distancia oficial. La modalidad nueva no genera crédito de distancia.",
    );
    expect(distanceImpactText({ from_m: 5000, to_m: 5000, from_generates_credit: false, to_generates_credit: true })).toBe("La modalidad nueva sí genera crédito de distancia.");
  });

  test("server refusals specific to a change are explained", () => {
    expect(changeFailureCopy({ code: "FORM_INVALID", details: { field_key: "category_id", reason: "required" } })?.title).toBe("Falta la categoría");
    expect(changeFailureCopy({ code: "FORM_INVALID", details: { field_key: "category_id", reason: "invalid_category" } })?.message).toContain("no pertenece");
    expect(changeFailureCopy({ code: "FORM_INVALID", details: { field_key: "talla", reason: "required_for_target_modality" } })?.title).toContain("pide una respuesta");
    expect(changeFailureCopy({ code: "PARTICIPANT_NOT_ELIGIBLE", details: { reasons: ["MODALITY_RULE", "NO_CATEGORY_MATCH", "SOMETHING_NEW"] } })?.lines).toEqual([
      "El participante no cumple la regla de edad o sexo de la modalidad.",
      "El participante no encaja en ninguna categoría de la modalidad.",
      "El participante no cumple una regla de elegibilidad.",
    ]);
    expect(changeFailureCopy({ code: "VALIDATION_ERROR", details: { field: "new_modality_id", reason: "same_as_current" } })?.title).toBe("Es la misma modalidad");
    // capacity and the rest speak through the shared error model
    expect(changeFailureCopy({ code: "CAPACITY_UNAVAILABLE", details: { modality_id: "m" } })).toBeNull();
  });
});

describe("display and export", () => {
  test("names and attendance degrade to something readable", () => {
    expect(displayName({ full_name: "  Ana Pérez ", registration_number: "I-1" })).toBe("Ana Pérez");
    expect(displayName({ full_name: null, registration_number: "I-AAAA-0001" })).toBe("Inscripción I-AAAA-0001");
    expect(attendanceText({ attendance: { checked_in: false, resolution_status: null } })).toBe("Sin resolver");
    expect(attendanceText({ attendance: { checked_in: true, resolution_status: "NO_SHOW" } })).toBe("No se presentó");
    expect(attendanceText({ attendance: { checked_in: true, resolution_status: "NEW_STATE" } })).toBe("NEW_STATE");
  });

  test("contact exists only when the API sent it", () => {
    expect(hasContact([{ contact: null }, { contact: null }])).toBe(false);
    expect(hasContact([{ contact: null }, { contact: { phone_e164: null, emergency_contact_name: null, emergency_contact_phone_e164: null } }])).toBe(true);
  });

  test("the export needs a reason of 3 to 500 characters and keeps the active filters, never the cursor", () => {
    expect(validateExportReason("ab")).toContain("mínimo 3");
    expect(validateExportReason("   ")).toContain("mínimo 3");
    expect(validateExportReason("x".repeat(501))).toBe("Máximo 500 caracteres.");
    expect(validateExportReason("Apoyo a la mesa")).toBeNull();
    expect(exportQuery({ status: "CONFIRMED", search: undefined, kit: "READY" }, "  Apoyo a la mesa ")).toBe("status=CONFIRMED&kit=READY&reason=Apoyo+a+la+mesa");
  });

  test("the saved file name comes from the server, restricted to safe characters", () => {
    expect(csvFileName('attachment; filename="participants-seed-carrera.csv"')).toBe("participants-seed-carrera.csv");
    expect(csvFileName('attachment; filename="../../etc/passwd"')).toBe("participantes.csv");
    expect(csvFileName(null)).toBe("participantes.csv");
  });
});
