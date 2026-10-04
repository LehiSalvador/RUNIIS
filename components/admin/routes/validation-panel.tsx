import React from "react";
import { CircleCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Panel } from "@/components/admin/panel";
import { formatDateTime } from "@/components/admin/format";
import { describeIssue, type ValidationResult } from "@/components/admin/routes/route-geometry";

/**
 * Result of the SERVER validation (Master §50): blocking errors in a danger list (they disable publishing), warnings in a warning list
 * (they never block). The client never computes a verdict; with unsaved edits the stored result describes the saved draft, and the
 * panel says so instead of pretending to be current.
 */
export function ValidationPanel({
  validation,
  dirty,
  editable,
  modalityName,
  timeZone,
}: {
  validation: ValidationResult | null;
  dirty: boolean;
  editable: boolean;
  modalityName: (id: string) => string | null;
  timeZone: string;
}) {
  return (
    <section id="route-validation" aria-label="Validación de la revisión" className="scroll-mt-24" data-testid="validation-panel">
      <Panel title="Validación" description="La hace el servidor sobre la revisión guardada; las advertencias no impiden publicar, los errores sí.">
        <div className="flex flex-col gap-3">
          {!validation ? (
            <p className="text-body-sm text-ink-60" data-testid="validation-none">
              {editable ? "Esta revisión todavía no se valida (o cambió desde la última validación). Guarda el borrador y pulsa «Validar»." : "Esta revisión no guarda un resultado de validación."}
            </p>
          ) : (
            <>
              <p className="text-caption text-ink-60">
                Validada el {formatDateTime(validation.validated_at, timeZone)}
                {dirty ? " · hay cambios sin guardar que esta validación no incluye" : ""}
              </p>
              {validation.errors.length > 0 ? (
                <Alert tone="danger" title={validation.errors.length === 1 ? "1 error impide publicar" : `${validation.errors.length} errores impiden publicar`}>
                  <ul className="list-disc space-y-0.5 pl-5" data-testid="validation-errors">
                    {validation.errors.map((issue, index) => (
                      <li key={`${issue.code}-${index}`} data-code={issue.code}>
                        {describeIssue(issue, modalityName)}
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <Alert tone="success" title="Sin errores bloqueantes">
                  La ruta cumple lo mínimo para publicarse.
                </Alert>
              )}
              {validation.warnings.length > 0 ? (
                <Alert tone="warning" title={validation.warnings.length === 1 ? "1 advertencia" : `${validation.warnings.length} advertencias`}>
                  <ul className="list-disc space-y-0.5 pl-5" data-testid="validation-warnings">
                    {validation.warnings.map((issue, index) => (
                      <li key={`${issue.code}-${index}`} data-code={issue.code}>
                        {describeIssue(issue, modalityName)}
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : validation.errors.length === 0 ? (
                <p className="flex items-center gap-2 text-body-sm text-ink-80">
                  <CircleCheck className="size-4 text-success" aria-hidden="true" />
                  Sin advertencias.
                </p>
              ) : null}
            </>
          )}
        </div>
      </Panel>
    </section>
  );
}
