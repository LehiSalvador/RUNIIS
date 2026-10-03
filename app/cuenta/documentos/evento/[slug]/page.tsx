import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { EditionDocuments } from "@/components/account/edition-documents";
import { buildEditionAcceptanceItems, editionDocumentsPath } from "@/components/account/logic/edition-documents";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { getRegistrationContext, listMyPendingActions } from "@/lib/server/domain/registration/service";

export const metadata: Metadata = { title: "Documentos del evento", robots: { index: false, follow: false } };

const TITLE = "Documentos del evento";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Params = Promise<{ slug: string }>;

/**
 * Master §124 / P2-AC-03.c: where an adult Friend (or the guardian of a minor) accepts the event documents of an edition before the
 * buyer submits. Deep link `/cuenta/documentos/evento/{slug}`: no session -> /entrar?next=<this page>, incomplete profile -> /onboarding.
 * Reads only the existing endpoints' domain functions (pending actions scoped to the edition + the registration context for the
 * documents and the minors this person guards) and never caches: acceptance state moves by the second.
 */
export default async function EditionDocumentsPage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!SLUG.test(slug) || slug.length > 160) notFound();
  const path = editionDocumentsPath(slug);
  const account = await requireReadyAccount(path);
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }

  const context = await settle(getRegistrationContext(account.supabase, slug));
  if (!context.ok) {
    if (context.code === "AUTH_REQUIRED") redirect(`/entrar?next=${encodeURIComponent(path)}`);
    if (context.code === "PROFILE_INCOMPLETE") redirect(`/onboarding?next=${encodeURIComponent(path)}`);
    if (context.code === "NOT_FOUND") notFound();
    return (
      <AccountShell pageTitle={TITLE}>
        <SectionError code={context.code} title="No pudimos cargar los documentos de este evento." />
      </AccountShell>
    );
  }
  // Historical slug: continue on the current one.
  if (context.data === null) notFound();
  if (context.data.redirect) redirect(editionDocumentsPath(context.data.slug));
  const ctx = context.data.context;

  const actions = await settle(listMyPendingActions(account.supabase, ctx.edition.edition_id));
  if (!actions.ok) {
    return (
      <AccountShell pageTitle={TITLE}>
        <SectionError code={actions.code} title="No pudimos cargar tus documentos pendientes." />
      </AccountShell>
    );
  }

  const items = buildEditionAcceptanceItems({
    editionId: ctx.edition.edition_id,
    actions: actions.data.items,
    contextDocuments: ctx.documents,
    candidates: ctx.candidates,
  });
  const signature = items.map((item) => `${item.key}:${item.documents.map((document) => document.legal_document_version_id).join("+")}`).join("|");

  return (
    <AccountShell pageTitle={TITLE}>
      <EditionDocuments
        key={signature}
        edition={{ edition_id: ctx.edition.edition_id, name: ctx.edition.name, slug: ctx.edition.slug }}
        items={items}
        registrationOpen={ctx.registration.can_register}
      />
    </AccountShell>
  );
}
