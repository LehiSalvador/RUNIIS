import { z } from "zod";

// Client-safe contract of the registration API (Master §61-84, §167-172). Pure: no server imports.

export const MAX_REQUEST_PARTICIPANTS = 20;
const MAX_TEXT_RESPONSE = 2000;
const FIELD_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

export const REQUEST_STATUSES = ["PENDING_CONFIRMATION", "CONFIRMED", "CANCELED_BY_BUYER", "CANCELED_BY_STAFF", "EXPIRED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Master §63/§72: expiry is effective at expires_at whether or not the worker has materialised it. */
export function effectiveRequestStatus(status: RequestStatus, expiresAt: string | null, now: Date = new Date()): RequestStatus {
  if (status === "PENDING_CONFIRMATION" && expiresAt !== null && now.getTime() >= Date.parse(expiresAt)) return "EXPIRED";
  return status;
}

const responseValueSchema = z.union([
  z.string().max(MAX_TEXT_RESPONSE),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
  z.null(),
]);

export const participantInputSchema = z
  .strictObject({
    kind: z.enum(["PROFILE", "GUEST"]),
    /** Friends and the buyer are addressed by their public profile id; runner ids stay internal. */
    public_profile_id: z.uuid().optional(),
    guest_participant_id: z.uuid().optional(),
    modality_id: z.uuid(),
    category_id: z.uuid().optional(),
    responses: z
      .record(z.string().regex(FIELD_KEY), responseValueSchema)
      .refine((value) => Object.keys(value).length <= 100, "too many responses")
      .optional(),
    kit_selection: z.strictObject({ kit_definition_id: z.uuid(), kit_variant_id: z.uuid() }).optional(),
  })
  .superRefine((participant, context) => {
    const valid =
      participant.kind === "PROFILE"
        ? participant.public_profile_id !== undefined && participant.guest_participant_id === undefined
        : participant.guest_participant_id !== undefined && participant.public_profile_id === undefined;
    if (!valid) context.addIssue({ code: "custom", message: "participant id must match kind", path: ["kind"] });
  });

export const legalAcceptanceInputSchema = z.strictObject({
  participant_index: z.int().min(0).max(MAX_REQUEST_PARTICIPANTS - 1),
  legal_document_version_id: z.uuid(),
});

export const createRegistrationRequestBodySchema = z.strictObject({
  edition_id: z.uuid(),
  participants: z.array(participantInputSchema).min(1).max(MAX_REQUEST_PARTICIPANTS),
  legal_acceptances: z.array(legalAcceptanceInputSchema).max(MAX_REQUEST_PARTICIPANTS * 5).default([]),
});
export type CreateRegistrationRequestBody = z.output<typeof createRegistrationRequestBodySchema>;

export const cancelReasonSchema = z.string().trim().min(1).max(500);
