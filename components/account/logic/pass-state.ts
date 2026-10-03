import type { PassView } from "@/lib/client/account-types";

/**
 * What a participant may do with a pass (P2-AC-12). The pass is valid for entry only while BOTH the pass is ACTIVE and its
 * registration is CONFIRMED; a revoked / canceled pass or a registration that is no longer confirmed never offers a QR.
 * `has_active_credential` is false right after a credential was replaced (and before the first one is issued): the pass
 * is still the participant's, a fresh code is issued when the QR is rendered, and any QR shown before the replacement
 * no longer validates. The browser never sees the credential: this is only presentation of the server's projection.
 */
export type PassState =
  | { kind: "VALID"; canShowQr: true; label: null; message: null }
  | { kind: "RENEWING"; canShowQr: true; label: string; message: string }
  | { kind: "REVOKED" | "CANCELED" | "REGISTRATION_INACTIVE"; canShowQr: false; label: string; message: string };

export function passState(pass: Pick<PassView, "status" | "has_active_credential" | "registration">): PassState {
  if (pass.status === "REVOKED") {
    return { kind: "REVOKED", canShowQr: false, label: "Revocado", message: "Este pase fue revocado y ya no es válido para entrar al evento. Si crees que es un error, contacta a soporte." };
  }
  if (pass.status !== "ACTIVE") {
    return { kind: "CANCELED", canShowQr: false, label: "Cancelado", message: "Este pase fue cancelado y ya no es válido para entrar al evento." };
  }
  if (pass.registration.status !== "CONFIRMED") {
    return { kind: "REGISTRATION_INACTIVE", canShowQr: false, label: "Inscripción no vigente", message: "La inscripción de este pase ya no está confirmada, así que el pase no es válido para entrar al evento." };
  }
  if (!pass.has_active_credential) {
    return {
      kind: "RENEWING",
      canShowQr: true,
      label: "Código en preparación",
      message: "Tu código se está preparando o se renovó. Cualquier QR anterior ya no sirve: muestra el nuevo al abrir este pase.",
    };
  }
  return { kind: "VALID", canShowQr: true, label: null, message: null };
}
