"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Award, CalendarX, Filter, Inbox, Mail, Medal, Search as SearchIcon, Ticket, Trophy } from "lucide-react";
import { Container } from "@/components/shell/container";
import { Wordmark } from "@/components/shell/wordmark";
import { Runline } from "@/components/ui/runline";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { FormField, fieldDescribedBy } from "@/components/ui/form-field";
import { TextField } from "@/components/ui/text-field";
import { SearchInput } from "@/components/ui/search-input";
import { DateInput } from "@/components/ui/date-input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, type StatusBadgeState } from "@/components/ui/status-badge";
import { Alert } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Stepper } from "@/components/ui/stepper";
import { Modal, ModalActions, ModalClose, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { toast } from "@/components/ui/use-toast";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard, SkeletonGroup, SkeletonRow, SkeletonText } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar";
import { CountdownStatus } from "@/components/ui/countdown-status";
import { QrCodeView, type QrCodeViewState } from "@/components/ui/qr-code-view";
import { RankingList, RankingRow } from "@/components/ui/ranking-row";
import { Podium } from "@/components/ui/podium";
import { AchievementBadge } from "@/components/ui/achievement-badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

// Literal class names (not interpolated) so Tailwind's source scanner finds them.
const COLOR_TOKENS: Array<{ name: string; className: string }> = [
  { name: "paper", className: "bg-paper" },
  { name: "paper-raised", className: "bg-paper-raised" },
  { name: "paper-sunken", className: "bg-paper-sunken" },
  { name: "ink", className: "bg-ink" },
  { name: "ink-80", className: "bg-ink-80" },
  { name: "ink-60", className: "bg-ink-60" },
  { name: "ink-35", className: "bg-ink-35" },
  { name: "divider", className: "bg-divider" },
  { name: "control", className: "bg-control" },
  { name: "lime", className: "bg-lime" },
  { name: "lime-deep", className: "bg-lime-deep" },
  { name: "lime-soft", className: "bg-lime-soft" },
  { name: "success", className: "bg-success" },
  { name: "success-tint", className: "bg-success-tint" },
  { name: "warning", className: "bg-warning" },
  { name: "warning-tint", className: "bg-warning-tint" },
  { name: "danger", className: "bg-danger" },
  { name: "danger-tint", className: "bg-danger-tint" },
  { name: "info", className: "bg-info" },
  { name: "info-tint", className: "bg-info-tint" },
];

const ALL_BADGE_STATES: StatusBadgeState[] = [
  "AVAILABLE", "LOW", "TEMPORARILY_UNAVAILABLE", "SOLD_OUT", "CLOSED", "NOT_OPEN", "FINISHED", "CANCELED",
  "POSTPONED", "REQUEST_PENDING", "REGISTRATION_CONFIRMED", "RANKING_OPEN", "RANKING_CONSOLIDATING", "RANKING_CLOSED",
];

const STEPS = [
  { id: "participantes", label: "Participantes" },
  { id: "modalidad", label: "Modalidad y kit" },
  { id: "legal", label: "Legal" },
  { id: "revision", label: "Revisión" },
  { id: "resultado", label: "Resultado" },
];

const SHELL_PREVIEWS = [
  { href: "/", label: "Público (Home interina)" },
  { href: "/design-system/shells/account", label: "Cuenta" },
  { href: "/design-system/shells/admin", label: "Administración" },
  { href: "/design-system/shells/scanner", label: "Scanner" },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-b border-divider py-10 lg:py-12">
      <h2 id={id} className="mb-6 font-display text-h2 font-bold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8 first:mt-0">
      <h3 className="mb-3 text-label font-semibold text-ink-60">{title}</h3>
      {children}
    </div>
  );
}

type Row = { id: string; number: string; name: string; modality: string; category: string; kit: string; status: StatusBadgeState };
const TABLE_ROWS: Row[] = [
  { id: "1", number: "0142", name: "Ana Torres", modality: "10K", category: "Libre", kit: "M", status: "REGISTRATION_CONFIRMED" },
  { id: "2", number: "0143", name: "Luis Cano", modality: "21K", category: "Élite", kit: "L", status: "REQUEST_PENDING" },
  { id: "3", number: "0151", name: "Marta Ruiz", modality: "5K", category: "Libre", kit: "S", status: "REGISTRATION_CONFIRMED" },
];
const TABLE_COLUMNS: DataTableColumn<Row>[] = [
  { key: "number", header: "Número", priority: 1, align: "right", render: (r) => r.number },
  { key: "name", header: "Nombre", priority: 1, sortable: true, render: (r) => r.name },
  { key: "status", header: "Estado", priority: 2, render: (r) => <StatusBadge state={r.status} /> },
  { key: "modality", header: "Modalidad", priority: 3, render: (r) => r.modality },
  { key: "category", header: "Categoría", priority: 4, render: (r) => r.category },
  { key: "kit", header: "Kit", priority: 5, render: (r) => r.kit },
];

export function DesignSystemPreview({ sampleQrSrc }: { sampleQrSrc: string }) {
  const [email, setEmail] = React.useState("");
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [birthDate, setBirthDate] = React.useState<{ iso: string | null; display: string }>({ iso: null, display: "" });
  const [birthTouched, setBirthTouched] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [checkboxState, setCheckboxState] = React.useState<boolean | "indeterminate">("indeterminate");
  const [activeTab, setActiveTab] = React.useState("weekly");
  const [stepId, setStepId] = React.useState("modalidad");
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [sort, setSort] = React.useState<"asc" | "desc">("asc");
  const [page, setPage] = React.useState(1);
  const [qrOpen, setQrOpen] = React.useState(false);
  const [qrState, setQrState] = React.useState<QrCodeViewState | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);
  const [demoTimes] = React.useState(() => {
    const now = Date.now();
    return {
      serverNow: new Date(now).toISOString(),
      live: new Date(now + 26 * 60 * 1000).toISOString(),
      warning: new Date(now + 4 * 60 * 1000 + 30_000).toISOString(),
      expired: new Date(now - 1000).toISOString(),
      compact: new Date(now + 45_000).toISOString(),
    };
  });

  // Stands in for the POST render-qr call: same Blob contract, with a visible loading phase.
  const failNextQrRef = React.useRef(false);
  const loadSampleQr = React.useCallback(
    async (signal: AbortSignal) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      signal.throwIfAborted();
      if (failNextQrRef.current) {
        failNextQrRef.current = false; // the retry then succeeds
        throw new Error("render failed");
      }
      const response = await fetch(sampleQrSrc, { signal });
      return response.blob();
    },
    [sampleQrSrc],
  );

  const emailError = emailTouched && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "Escribe un correo válido, por ejemplo nombre@correo.com." : undefined;
  const birthError = birthTouched && birthDate.display !== "" && !birthDate.iso ? "Escribe una fecha real con el formato dd/mm/aaaa." : undefined;
  const sortedRows = [...TABLE_ROWS].sort((a, b) => (sort === "asc" ? 1 : -1) * a.name.localeCompare(b.name, "es"));

  return (
    <div className="min-h-dvh bg-paper pb-24">
      <header className="border-b border-divider bg-paper-raised">
        <Container className="py-8 lg:py-12">
          <Wordmark />
          <h1 className="mt-6 font-display text-h1 font-bold text-ink">Sistema de diseño</h1>
          <p className="mt-3 max-w-2xl text-body-lg text-ink-80">
            Vista interna de QA: cada componente base con sus estados. No indexada y deshabilitada en producción.
          </p>
          <nav aria-label="Shells" className="mt-6 flex flex-wrap gap-2">
            {SHELL_PREVIEWS.map((shell) => (
              <Button key={shell.href} asChild variant="secondary" size="sm">
                <Link href={shell.href}>
                  {shell.label}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            ))}
          </nav>
        </Container>
      </header>

      <main id="main-content">
        <Container>
          <Section id="ds-color" title="Color">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {COLOR_TOKENS.map((token) => (
                <li key={token.name} className="overflow-hidden rounded-card border border-divider bg-paper-raised">
                  <div className={`h-14 ${token.className}`} />
                  <p className="px-3 py-2 text-caption text-ink-80">{token.name}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="ds-type" title="Tipografía">
            <div className="space-y-4">
              <p className="font-display text-display-xl font-bold tabular-nums text-ink">42.195 km</p>
              <p className="font-display text-h1 font-bold text-ink">Medio Maratón Ciudad</p>
              <p className="font-display text-h2 font-bold text-ink">Próximas carreras</p>
              <p className="text-h3 font-bold text-ink">Tu inscripción</p>
              <p className="text-h4 font-semibold text-ink">Modalidad y kit</p>
              <p className="max-w-2xl text-body-lg text-ink-80">Cuerpo grande: resumen editorial de una carrera, lectura cómoda en móvil.</p>
              <p className="max-w-2xl text-body text-ink">Cuerpo: textos de formularios, tarjetas y contenido general.</p>
              <p className="text-body-sm text-ink-80">Cuerpo pequeño: tablas de administración y metadatos.</p>
              <p className="text-label font-semibold text-ink">Etiqueta de campo</p>
              <p className="text-caption text-ink-60">Metadato · 12 de octubre de 2026 · 07:00</p>
            </div>
          </Section>

          <Section id="ds-runline" title="Runline">
            <div className="flex flex-col gap-4">
              <Runline weight="normal" tone="signal" className="w-24" />
              <Runline weight="strong" tone="signal" className="w-24" />
              <Runline weight="strong" tone="neutral" className="w-24" />
            </div>
          </Section>

          <Section id="ds-button" title="Button e IconButton">
            <Sub title="Variantes">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary">Inscribirme</Button>
                <Button variant="secondary">Ver detalles</Button>
                <Button variant="ghost">Cancelar</Button>
                <Button variant="danger">Cancelar solicitud</Button>
              </div>
            </Sub>
            <Sub title="Tamaños y estados">
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Pequeño</Button>
                <Button size="md">Mediano</Button>
                <Button size="lg">Grande</Button>
                <Button
                  loading={saving}
                  onClick={() => {
                    setSaving(true);
                    setTimeout(() => setSaving(false), 1500);
                  }}
                >
                  Guardar cambios
                </Button>
                <Button disabled>No disponible</Button>
              </div>
            </Sub>
            <Sub title="IconButton">
              <div className="flex flex-wrap items-center gap-3">
                <IconButton aria-label="Buscar (pequeño)" size="sm"><SearchIcon className="size-5" aria-hidden="true" /></IconButton>
                <IconButton aria-label="Buscar"><SearchIcon className="size-5" aria-hidden="true" /></IconButton>
                <IconButton aria-label="Buscar (relleno)" variant="filled" size="lg"><SearchIcon className="size-5" aria-hidden="true" /></IconButton>
                <IconButton aria-label="Buscando" loading />
                <IconButton aria-label="Buscar (deshabilitado)" disabled><SearchIcon className="size-5" aria-hidden="true" /></IconButton>
                <div className="surface-ink rounded-control bg-ink p-1">
                  <IconButton aria-label="Buscar (sobre tinta)" variant="inverse"><SearchIcon className="size-5" aria-hidden="true" /></IconButton>
                </div>
              </div>
            </Sub>
          </Section>

          <Section id="ds-forms" title="Formularios">
            <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
              <FormField id="ds-email" label="Correo" required errorText={emailError} helperText="Te enviaremos un código de acceso.">
                <TextField
                  id="ds-email"
                  type="email"
                  autoComplete="email"
                  leadingIcon={<Mail className="size-4" aria-hidden="true" />}
                  value={email}
                  invalid={Boolean(emailError)}
                  aria-describedby={fieldDescribedBy("ds-email", Boolean(emailError), true)}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  placeholder="nombre@correo.com"
                />
              </FormField>

              <FormField id="ds-birth" label="Fecha de nacimiento" errorText={birthError} helperText="Formato dd/mm/aaaa.">
                <DateInput
                  id="ds-birth"
                  autoComplete="bday"
                  max="2026-12-31"
                  invalid={Boolean(birthError)}
                  aria-describedby={fieldDescribedBy("ds-birth", Boolean(birthError), true)}
                  value={birthDate.iso ?? ""}
                  onValueChange={(iso, display) => setBirthDate({ iso, display })}
                  onBlur={() => setBirthTouched(true)}
                />
              </FormField>

              <FormField id="ds-select" label="Modalidad">
                <Select defaultValue="10k">
                  <SelectTrigger id="ds-select">
                    <SelectValue placeholder="Elige una modalidad" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5k">5K</SelectItem>
                    <SelectItem value="10k">10K</SelectItem>
                    <SelectItem value="21k">21K</SelectItem>
                    <SelectItem value="42k" disabled>42K (agotado)</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField id="ds-search" label="Buscar evento">
                <SearchInput
                  id="ds-search"
                  placeholder="Buscar evento, ciudad o distancia"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onClear={() => setSearch("")}
                />
              </FormField>

              <FormField id="ds-code" label="Código verificado" helperText="Validado en el servidor.">
                <TextField id="ds-code" defaultValue="482913" success aria-describedby="ds-code-helper" inputMode="numeric" />
              </FormField>

              <FormField id="ds-disabled" label="Campo deshabilitado" helperText="Se edita desde tu perfil.">
                <TextField id="ds-disabled" defaultValue="Ana Torres" disabled aria-describedby="ds-disabled-helper" />
              </FormField>

              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-label font-semibold text-ink">Checkbox</legend>
                <Checkbox id="ds-cb-1" label="Acepto los términos del evento" checked={checkboxState} onCheckedChange={setCheckboxState} />
                <Checkbox id="ds-cb-2" label="Opción deshabilitada" disabled />
              </fieldset>

              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-label font-semibold text-ink">Forma de inscripción</legend>
                <RadioGroup defaultValue="whatsapp" className="flex flex-col gap-1">
                  <RadioItem id="ds-radio-1" value="whatsapp" label="Confirmar por WhatsApp" />
                  <RadioItem id="ds-radio-2" value="free" label="Registro gratuito" />
                  <RadioItem id="ds-radio-3" value="closed" label="Cerrado" disabled />
                </RadioGroup>
              </fieldset>
            </div>
          </Section>

          <Section id="ds-status" title="StatusBadge">
            <ul className="flex flex-wrap gap-2">
              {ALL_BADGE_STATES.map((state) => (
                <li key={state}>
                  <StatusBadge state={state} />
                </li>
              ))}
            </ul>
            <Sub title="Como chip de filtro">
              <div className="flex flex-wrap gap-2">
                <StatusBadge state="AVAILABLE" asFilterChip selected onSelectedChange={() => {}} />
                <StatusBadge state="LOW" asFilterChip selected={false} onSelectedChange={() => {}} />
              </div>
            </Sub>
          </Section>

          <Section id="ds-alert" title="Alert / Callout">
            <div className="flex max-w-3xl flex-col gap-3">
              <Alert tone="info" title="Proyección, no resultado oficial">El ranking se consolida al cierre del periodo.</Alert>
              <Alert tone="success" title="Inscripción confirmada">Tu pase ya está disponible en Mi cuenta.</Alert>
              <Alert tone="warning" title="Quedan pocos lugares" dismissible onDismiss={() => {}} />
              <Alert tone="danger" title="No pudimos generar tu código. Intenta de nuevo." />
            </div>
          </Section>

          <Section id="ds-tabs" title="Tabs">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList aria-label="Periodo del ranking">
                <TabsTrigger value="weekly">Semanal</TabsTrigger>
                <TabsTrigger value="monthly">Mensual</TabsTrigger>
                <TabsTrigger value="historical">Histórico</TabsTrigger>
              </TabsList>
              <TabsContent value="weekly" className="pt-4 text-body-sm text-ink-80">Ranking semanal.</TabsContent>
              <TabsContent value="monthly" className="pt-4 text-body-sm text-ink-80">Ranking mensual.</TabsContent>
              <TabsContent value="historical" className="pt-4 text-body-sm text-ink-80">Ranking histórico.</TabsContent>
            </Tabs>
          </Section>

          <Section id="ds-stepper" title="Stepper">
            <div className="max-w-[var(--container-registration)]">
              <Stepper aria-label="Progreso de inscripción" steps={STEPS} currentStepId={stepId} onStepSelect={setStepId} />
              <div className="mt-6 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={stepId === STEPS[0].id}
                  onClick={() => setStepId(STEPS[Math.max(0, STEPS.findIndex((s) => s.id === stepId) - 1)].id)}
                >
                  Anterior
                </Button>
                <Button
                  size="sm"
                  disabled={stepId === STEPS[STEPS.length - 1].id}
                  onClick={() => setStepId(STEPS[Math.min(STEPS.length - 1, STEPS.findIndex((s) => s.id === stepId) + 1)].id)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </Section>

          <Section id="ds-overlays" title="Modal, Drawer y Toast">
            <div className="flex flex-wrap gap-3">
              <Modal>
                <ModalTrigger asChild>
                  <Button variant="secondary">Confirmación</Button>
                </ModalTrigger>
                <ModalContent title="¿Marcar como no presentados?" description="Esto afecta a 3 participantes y no se puede deshacer desde aquí.">
                  <ModalActions>
                    <ModalClose asChild>
                      <Button variant="ghost">Cancelar</Button>
                    </ModalClose>
                    <ModalClose asChild>
                      <Button variant="danger">Marcar 3 como no presentados</Button>
                    </ModalClose>
                  </ModalActions>
                </ModalContent>
              </Modal>

              <Modal>
                <ModalTrigger asChild>
                  <Button variant="secondary">Formulario en modal</Button>
                </ModalTrigger>
                <ModalContent title="Verificar guardián" description="Laura Ruiz, madre. Elige cómo verificaste su identidad.">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                    }}
                  >
                    <FormField id="ds-modal-method" label="Método de verificación" required>
                      <Select>
                        <SelectTrigger id="ds-modal-method">
                          <SelectValue placeholder="Elige un método" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="id">Identificación oficial</SelectItem>
                          <SelectItem value="in_person">En persona con el menor</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField id="ds-modal-notes" label="Notas (opcional)">
                      <TextField id="ds-modal-notes" />
                    </FormField>
                    <ModalActions>
                      <ModalClose asChild>
                        <Button variant="secondary" type="button">Rechazar</Button>
                      </ModalClose>
                      <Button type="submit">Verificar</Button>
                    </ModalActions>
                  </form>
                </ModalContent>
              </Modal>

              <Drawer>
                <DrawerTrigger asChild>
                  <Button variant="secondary">
                    <Filter className="size-4" aria-hidden="true" />
                    Filtros
                  </Button>
                </DrawerTrigger>
                <DrawerContent
                  title="Filtros"
                  footer={
                    <>
                      <Button variant="ghost">Limpiar filtros</Button>
                      <DrawerClose asChild>
                        <Button>Ver 12 resultados</Button>
                      </DrawerClose>
                    </>
                  }
                >
                  <fieldset className="flex flex-col gap-1">
                    <legend className="mb-1 text-label font-semibold text-ink">Distancia</legend>
                    <Checkbox id="ds-f-5k" label="5K" />
                    <Checkbox id="ds-f-10k" label="10K" />
                    <Checkbox id="ds-f-21k" label="21K" />
                  </fieldset>
                </DrawerContent>
              </Drawer>

              <Button variant="secondary" onClick={() => toast({ tone: "success", title: "Cambios guardados" })}>
                Toast éxito
              </Button>
              <Button variant="secondary" onClick={() => toast({ tone: "info", title: "Te avisaremos cuando abran inscripciones" })}>
                Toast info
              </Button>
              <Button
                variant="secondary"
                onClick={() => toast({ tone: "danger", title: "No pudimos guardar los cambios", description: "Revisa tu conexión e intenta de nuevo." })}
              >
                Toast error
              </Button>
            </div>
          </Section>

          <Section id="ds-pagination" title="Pagination">
            <div className="flex flex-col items-start gap-6">
              <Pagination page={page} pageCount={5} onPageChange={setPage} />
              <Pagination variant="cursor" hasMore onLoadMore={() => {}} />
            </div>
          </Section>

          <Section id="ds-empty" title="EmptyState y Skeleton">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-card border border-divider bg-paper-raised">
                <EmptyState icon={CalendarX} title="No hay carreras próximas" description="Publicaremos nuevas fechas pronto." />
              </div>
              <div className="rounded-card border border-divider bg-paper-raised">
                <EmptyState
                  icon={Ticket}
                  title="Aún no tienes pases"
                  description="Cuando confirmen tu inscripción, tu pase aparecerá aquí."
                  action={
                    <Button asChild size="sm" variant="secondary">
                      <Link href="/eventos">Explorar eventos</Link>
                    </Button>
                  }
                />
              </div>
              <div className="rounded-card border border-divider bg-paper-raised">
                <EmptyState icon={Inbox} title="Sin solicitudes pendientes" description="Las nuevas solicitudes aparecerán aquí." />
              </div>
            </div>
            <Sub title="Skeleton">
              <SkeletonGroup label="Cargando eventos" className="grid gap-4 sm:grid-cols-3">
                <SkeletonCard />
                <div className="flex flex-col gap-3">
                  <SkeletonRow columns={4} />
                  <SkeletonRow columns={4} />
                  <SkeletonRow columns={4} />
                </div>
                <SkeletonText lines={4} />
              </SkeletonGroup>
            </Sub>
          </Section>

          <Section id="ds-avatar" title="Avatar">
            <div className="flex flex-wrap items-end gap-5">
              <Avatar displayName="Ana Torres" size={24} />
              <Avatar displayName="Ana Torres" size={32} />
              <Avatar displayName="Luis Cano" size={40} />
              <Avatar displayName="Marta Ruiz" size={64} status="pending" />
              <Avatar displayName="Jorge Díaz" size={96} status="suspended" />
              <Avatar displayName="" size={64} />
            </div>
          </Section>

          <Section id="ds-countdown" title="CountdownStatus">
            <div className="flex flex-wrap gap-x-12 gap-y-8">
              <CountdownStatus expiresAt={demoTimes.live} serverNow={demoTimes.serverNow} />
              <CountdownStatus expiresAt={demoTimes.warning} serverNow={demoTimes.serverNow} />
              <CountdownStatus expiresAt={demoTimes.expired} serverNow={demoTimes.serverNow} />
              <CountdownStatus expiresAt={demoTimes.compact} variant="compact" label="Reenviar código en" expiredLabel="Ya puedes reenviar el código" />
            </div>
          </Section>

          <Section id="ds-qr" title="QRCodeView">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setQrState(undefined);
                  setQrOpen(true);
                }}
              >
                Ver código QR
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setQrState("loading");
                  setQrOpen(true);
                }}
              >
                QR cargando
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  failNextQrRef.current = true;
                  setQrState(undefined);
                  setQrOpen(true);
                }}
              >
                QR con error
              </Button>
            </div>
            <QrCodeView
              open={qrOpen}
              onOpenChange={setQrOpen}
              state={qrState}
              publicCode="RN-8F3K-Q2"
              loadQr={loadSampleQr}
            />
          </Section>

          <Section id="ds-ranking" title="Ranking, Podium y logros">
            <div className="grid gap-10 lg:grid-cols-2">
              <Sub title="Podio (periodo abierto)">
                <Podium
                  periodStatus="OPEN"
                  occupants={[
                    { id: "p1", rank: 1, displayName: "Ana Torres", metricLabel: "km", metricValue: "142.3" },
                    { id: "p2", rank: 2, displayName: "Luis Cano", metricLabel: "km", metricValue: "138.1" },
                    { id: "p3", rank: 3, displayName: "Marta Ruiz", metricLabel: "km", metricValue: "129.4", isCurrentViewer: true },
                  ]}
                />
              </Sub>
              <Sub title="Podio con empate en primer lugar (cerrado)">
                <Podium
                  periodStatus="CLOSED"
                  snapshotDate="31 de agosto de 2026"
                  occupants={[
                    { id: "t1", rank: 1, displayName: "Ana Torres", metricLabel: "km", metricValue: "142.3", tied: true },
                    { id: "t2", rank: 1, displayName: "Luis Cano", metricLabel: "km", metricValue: "142.3", tied: true },
                    { id: "t3", rank: 3, displayName: "Marta Ruiz", metricLabel: "km", metricValue: "129.4" },
                  ]}
                />
              </Sub>
              <Sub title="Más de tres en el podio (lista)">
                <Podium
                  periodStatus="CONSOLIDATING"
                  occupants={[
                    { id: "l1", rank: 1, displayName: "Ana Torres", metricLabel: "km", metricValue: "142.3" },
                    { id: "l2", rank: 2, displayName: "Luis Cano", metricLabel: "km", metricValue: "138.1", tied: true },
                    { id: "l3", rank: 2, displayName: "Marta Ruiz", metricLabel: "km", metricValue: "138.1", tied: true },
                    { id: "l4", rank: 2, displayName: "Jorge Díaz", metricLabel: "km", metricValue: "138.1", tied: true },
                  ]}
                />
              </Sub>
              <Sub title="RankingRow">
                <RankingList aria-label="Ranking mensual" className="rounded-card border border-divider bg-paper-raised">
                  <RankingRow id="r4" rank={4} displayName="Sofía Méndez" metricLabel="km" metricValue="120.0" />
                  <RankingRow id="r5" rank={5} displayName="Marta Ruiz" metricLabel="km" metricValue="118.6" isCurrentViewer />
                  <RankingRow id="r6" rank={6} displayName="Jorge Díaz" metricLabel="km" metricValue="101.2" tied />
                  <RankingRow id="r7" rank={6} displayName="Paola Ríos" metricLabel="km" metricValue="101.2" tied />
                </RankingList>
              </Sub>
            </div>
            <Sub title="AchievementBadge">
              <div className="flex flex-wrap gap-6">
                <AchievementBadge icon={Trophy} name="Primer 10K" />
                <AchievementBadge icon={Medal} name="5 carreras" />
                <AchievementBadge icon={Award} name="Podio mensual" variant="admin-revoked" onOpenHistory={() => {}} />
              </div>
            </Sub>
          </Section>

          <Section id="ds-table" title="DataTable">
            <DataTable
              caption="Participantes"
              columns={TABLE_COLUMNS}
              rows={sortedRows}
              getRowId={(r) => r.id}
              getRowLabel={(r) => r.name}
              keepColumnsBelowLg={3}
              keepColumnsBelowMd={2}
              sortKey="name"
              sortDirection={sort}
              onSortChange={() => setSort((s) => (s === "asc" ? "desc" : "asc"))}
              selectable
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              canExportCsv
              onExportCsv={() => {}}
              rowActions={(r) => (
                <Button size="sm" variant="ghost" aria-label={`Revisar a ${r.name}`}>
                  Revisar
                </Button>
              )}
            />
            <div className="mt-8 grid gap-8 lg:grid-cols-2">
              <Sub title="Cargando">
                <DataTable caption="Participantes (cargando)" columns={TABLE_COLUMNS} rows={[]} getRowId={(r) => r.id} loading loadingRowCount={3} />
              </Sub>
              <Sub title="Vacía">
                <DataTable
                  caption="Participantes (vacía)"
                  columns={TABLE_COLUMNS}
                  rows={[]}
                  getRowId={(r) => r.id}
                  emptyState={{ icon: SearchIcon, title: "Ningún participante coincide", description: "Prueba con otro nombre o número." }}
                />
              </Sub>
            </div>
          </Section>
        </Container>
      </main>
    </div>
  );
}
