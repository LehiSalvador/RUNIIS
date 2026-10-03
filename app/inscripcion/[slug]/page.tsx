import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireReadyAccount } from "@/app/cuenta/_lib/session";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { RegistrationFlow } from "@/components/registration/registration-flow";
import { Container } from "@/components/shell/container";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toAppError } from "@/lib/server/http/errors";
import { getRegistrationContext } from "@/lib/server/domain/registration/service";

export const metadata: Metadata = { title: "Inscripción", robots: { index: false, follow: false } };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Params = Promise<{ slug: string }>;

const ERROR_COPY: Record<string, string> = {
  RATE_LIMITED: "Consultaste esta página muy seguido. Espera un momento e intenta de nuevo.",
  DEPENDENCY_UNAVAILABLE: "El servicio no está disponible. Intenta más tarde.",
};

/**
 * /inscripcion/[slug] (Master §61-76, ux-spec J1). Server guard: no session -> /entrar?next=<this page>,
 * incomplete profile -> /onboarding, restricted account -> its state. The server-authoritative registration
 * context (availability, price, eligibility, forms, documents, candidates) is read here, per request and
 * never cached, and handed to the client flow which re-reads it whenever the server says the state moved.
 * No `loading.tsx` on purpose: a streamed fallback would answer 200 before the guard's redirect (AUD-033).
 */
export default async function RegistrationPage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  const path = `/inscripcion/${slug}`;
  const account = await requireReadyAccount(path);

  if (account.restriction) {
    return (
      <Container width="registration" className="py-8 md:py-12">
        <h1 className="mb-6 font-display text-h1 font-bold text-ink">Inscripción</h1>
        <RestrictedAccount restriction={account.restriction} />
      </Container>
    );
  }

  let result: Awaited<ReturnType<typeof getRegistrationContext>>;
  try {
    result = await getRegistrationContext(account.supabase, slug);
  } catch (error) {
    const code = toAppError(error, { surface: "registration_page" }).code;
    if (code === "AUTH_REQUIRED") redirect(`/entrar?next=${encodeURIComponent(path)}`);
    if (code === "PROFILE_INCOMPLETE") redirect(`/onboarding?next=${encodeURIComponent(path)}`);
    if (code === "NOT_FOUND") notFound();
    return (
      <Container width="registration" className="py-8 md:py-12">
        <h1 className="mb-6 font-display text-h1 font-bold text-ink">Inscripción</h1>
        <Alert
          tone="danger"
          title="No pudimos cargar la inscripción."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href={path}>Reintentar</Link>
            </Button>
          }
        >
          {ERROR_COPY[code] ?? "Algo salió mal de nuestro lado. Intenta de nuevo en un momento."}
        </Alert>
      </Container>
    );
  }

  if (!result) notFound();
  // A historical slug: continue on the current one (the API answers 308 for the same case).
  if (result.redirect) redirect(`/inscripcion/${result.slug}`);

  return (
    <Container width="registration" className="py-8 md:py-12">
      <RegistrationFlow initialContext={result.context} slug={result.context.edition.slug} />
    </Container>
  );
}
