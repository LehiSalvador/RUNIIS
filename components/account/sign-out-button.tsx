"use client";

import React from "react";
import { LogOut } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { apiFetch } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";

/** Server-side sign-out (refresh token revoked at GoTrue), then a full navigation so no cached signed-in UI survives. */
export function SignOutButton({ variant = "secondary", size = "md", className }: Pick<ButtonProps, "variant" | "size" | "className">) {
  const [pending, setPending] = React.useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    const result = await apiFetch("/api/v1/auth/signout", { method: "POST" });
    if (result.ok || result.code === "AUTH_REQUIRED") {
      window.location.replace("/");
      return;
    }
    setPending(false);
    toast({ tone: "danger", title: "No pudimos cerrar tu sesión.", description: errorMessage(result) });
  }

  return (
    <Button variant={variant} size={size} className={className} loading={pending} onClick={signOut}>
      <LogOut className="size-4" aria-hidden="true" />
      Cerrar sesión
    </Button>
  );
}
