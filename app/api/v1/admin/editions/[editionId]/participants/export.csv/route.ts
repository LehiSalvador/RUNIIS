import { z } from "zod";
import { toCsv, type CsvValue } from "@/lib/server/domain/registration/csv";
import { participantExportQuerySchema, type ParticipantRow } from "@/lib/server/domain/registration/contracts";
import { adminExportParticipants } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ editionId: z.guid() });

const HEADER = [
  "registration_number",
  "full_name",
  "buyer_full_name",
  "modality",
  "category",
  "status",
  "is_minor",
  "guardian_verification_status",
  "pass_public_code",
  "pass_status",
  "kit_status",
  "kit_variant_label",
  "checked_in",
  "attendance_resolution_status",
  "phone_e164",
  "emergency_contact_name",
  "emergency_contact_phone_e164",
] as const;

function toRow(participant: ParticipantRow): readonly CsvValue[] {
  return [
    participant.registration_number,
    participant.full_name,
    participant.buyer_full_name,
    participant.modality.name,
    participant.category?.name ?? null,
    participant.status,
    participant.is_minor,
    participant.guardian_verification_status,
    participant.pass?.public_code ?? null,
    participant.pass?.status ?? null,
    participant.kit?.status ?? null,
    participant.kit?.variant_label ?? null,
    participant.attendance.checked_in,
    participant.attendance.resolution_status,
    participant.contact?.phone_e164 ?? null,
    participant.contact?.emergency_contact_name ?? null,
    participant.contact?.emergency_contact_phone_e164 ?? null,
  ];
}

// PII_EXPORT (ADMIN only, global): SEC-023 explicit permission + reason, audited row count (never rows).
export const GET = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { params: paramsSchema, query: participantExportQuerySchema } },
  async ({ supabase, input }) => {
    const { reason, ...filters } = input.query;
    const result = await adminExportParticipants(supabase, input.params.editionId, reason, filters);
    const csv = toCsv(HEADER, result.rows.map(toRow));
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="participants-${result.edition.slug}.csv"`,
      },
    });
  },
);
