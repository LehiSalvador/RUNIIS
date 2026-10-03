"use client";

import React from "react";
import { LogOut } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { apiFetch, type ApiFailure, type ApiResult } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import { clearAllDrafts } from "@/components/registration/logic/draft-storage";

/**
 * Ends the session at the server and, once it is over (or was already over), clears every registration draft of this
 * tab so typed answers cannot reach the next account (H2P2-03). Returns null when signed out, else the failure.
 */
export async function endSession(call: (path: string, request: { method: "POST" }) => Promise<ApiResult<unknown>> = apiFetch): Promise<ApiFailure | null> {
  const result = await call("/api/v1/auth/signout", { method: "POST" });
  if (result.ok || result.code === "AUTH_REQUIRED") {
    clearAllDrafts();
    return null;
  }
  return result;
}

/** Server-side sign-out (refresh token revoked at GoTrue), then a full navigation so no cached signed-in UI survives. */
export function SignOutButton({ variant = "secondary", size = "md", className }: Pick<ButtonProps, "variant" | "size" | "className">) {
  const [pending, setPending] = React.useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    const failure = await endSession();
    if (!failure) {
      window.location.replace("/");
      return;
    }
    setPending(false);
    toast({ tone: "danger", title: "No pudimos cerrar tu sesión.", description: errorMessage(failure) });
  }

  return (
    <Button variant={variant} size={size} className={className} loading={pending} onClick={signOut}>
      <LogOut className="size-4" aria-hidden="true" />
      Cerrar sesión
    </Button>
  );
}
