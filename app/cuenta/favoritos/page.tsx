import type { Metadata } from "next";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { FavoritesList } from "@/components/account/favorites-list";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { listMyFavorites } from "@/lib/server/domain/communications/service";

export const metadata: Metadata = { title: "Favoritos" };

const TITLE = "Favoritos";

export default async function FavoritesPage() {
  const account = await requireReadyAccount("/cuenta/favoritos");
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  const favorites = await settle(listMyFavorites(account.supabase));

  return (
    <AccountShell pageTitle={TITLE}>
      <p className="mb-6 max-w-[var(--container-reading)] text-body text-ink-80">
        Carreras que guardaste. Marcar un favorito no te suscribe a ningún correo; los recordatorios son opcionales.
      </p>
      {favorites.ok ? <FavoritesList favorites={favorites.data} /> : <SectionError code={favorites.code} title="No pudimos cargar tus favoritos." />}
    </AccountShell>
  );
}
