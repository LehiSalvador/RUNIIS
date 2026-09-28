import { describe, expect, test } from "vitest";
import {
  ageBand,
  ageOn,
  formatPhone,
  normalizePhone,
  todayInBusinessZone,
  toPersonPayload,
  validatePersonFields,
  type PersonFields,
} from "@/lib/client/person-fields";

const valid: PersonFields = {
  full_name: "  Ana   Pérez ",
  date_of_birth: "1991-03-14",
  sex_code: "F",
  phone_e164: "81 1234 5678",
  emergency_contact_name: "Rosa Pérez",
  emergency_contact_phone_e164: "+52 (81) 8765-4321",
  emergency_contact_relationship: "Madre",
};

describe("ageOn / ageBand (Master §19: <15 rejected, 15-17 minor)", () => {
  test("counts whole years, birthday not yet reached", () => {
    expect(ageOn("2010-10-10", "2026-10-09")).toBe(15);
    expect(ageOn("2010-10-10", "2026-10-10")).toBe(16);
  });
  test("bands", () => {
    expect(ageBand(14)).toBe("UNDER_MIN");
    expect(ageBand(15)).toBe("MINOR");
    expect(ageBand(17)).toBe("MINOR");
    expect(ageBand(18)).toBe("ADULT");
  });
  test("business day is America/Monterrey, not UTC", () => {
    // 2026-03-01T03:00Z is still Feb 28 21:00 in Monterrey (UTC-6).
    expect(todayInBusinessZone(new Date("2026-03-01T03:00:00Z"))).toBe("2026-02-28");
  });
});

describe("normalizePhone", () => {
  test("bare 10 digits are Mexican numbers", () => {
    expect(normalizePhone("81 1234 5678")).toBe("+528112345678");
    expect(normalizePhone("(81) 1234-5678")).toBe("+528112345678");
  });
  test("keeps international numbers and 52-prefixed digits", () => {
    expect(normalizePhone("+1 415 555 0100")).toBe("+14155550100");
    expect(normalizePhone("528112345678")).toBe("+528112345678");
  });
  test("rejects garbage", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
  });
  test("formatPhone groups Mexican numbers only", () => {
    expect(formatPhone("+528112345678")).toBe("+52 81 1234 5678");
    expect(formatPhone("+14155550100")).toBe("+14155550100");
    expect(formatPhone(null)).toBe("");
  });
});

describe("validatePersonFields", () => {
  test("accepts a complete adult", () => {
    expect(validatePersonFields(valid, "2026-09-28").size).toBe(0);
  });
  test("flags every empty field", () => {
    const errors = validatePersonFields(
      { full_name: "", date_of_birth: null, sex_code: "", phone_e164: "", emergency_contact_name: "", emergency_contact_phone_e164: "", emergency_contact_relationship: "" },
      "2026-09-28",
    );
    expect([...errors.keys()]).toEqual([
      "full_name",
      "date_of_birth",
      "sex_code",
      "phone_e164",
      "emergency_contact_name",
      "emergency_contact_phone_e164",
      "emergency_contact_relationship",
    ]);
  });
  test("under 15 and future dates are invalid; 15-17 is allowed", () => {
    expect(validatePersonFields({ ...valid, date_of_birth: "2012-01-01" }, "2026-09-28").get("date_of_birth")).toMatch(/15 años/);
    expect(validatePersonFields({ ...valid, date_of_birth: "2027-01-01" }, "2026-09-28").has("date_of_birth")).toBe(true);
    expect(validatePersonFields({ ...valid, date_of_birth: "2010-01-01" }, "2026-09-28").size).toBe(0);
  });
  test("payload collapses whitespace and sends E.164", () => {
    expect(toPersonPayload(valid)).toEqual({
      full_name: "Ana Pérez",
      date_of_birth: "1991-03-14",
      sex_code: "F",
      phone_e164: "+528112345678",
      emergency_contact_name: "Rosa Pérez",
      emergency_contact_phone_e164: "+528187654321",
      emergency_contact_relationship: "Madre",
    });
  });
});
