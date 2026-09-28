"use client";

import React from "react";
import { MapPin } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { DateInput } from "@/components/ui/date-input";
import { FormField, fieldDescribedBy } from "@/components/ui/form-field";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/client/cn";
import { displayToIso, isoToDisplay } from "@/lib/client/date-input";
import { EVENT_TYPES } from "@/lib/shared/public-event";
import {
  DISTANCE_PRESETS,
  PRICE_OPTIONS,
  distancePresetKey,
  type EventFilters,
  type PriceFilter,
} from "@/lib/shared/event-filters";

function Group({ legend, children, className }: { legend: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={cn("border-t border-divider pt-5 first:border-t-0 first:pt-0", className)}>
      <legend className="float-left mb-2 w-full text-label font-semibold text-ink">{legend}</legend>
      <div className="clear-both">{children}</div>
    </fieldset>
  );
}

function toggle<T>(list: T[], value: T, on: boolean): T[] {
  return on ? [...new Set([...list, value])] : list.filter((item) => item !== value);
}

type DateErrors = { from?: string; to?: string };

/**
 * The six Master §54 filter dimensions. Controlled by `value`; `onChange` receives only valid,
 * complete filter states -- a half-typed or impossible date stays local with an inline error and is
 * never sent (the backend rejects date_to < date_from, and the URL must always be a valid query).
 */
export function FilterPanel({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: EventFilters;
  onChange: (next: EventFilters) => void;
}) {
  const [location, setLocation] = React.useState(value.location ?? "");
  const [lastLocation, setLastLocation] = React.useState(value.location);
  if (value.location !== lastLocation) {
    setLastLocation(value.location);
    setLocation(value.location ?? "");
  }
  const [dateText, setDateText] = React.useState({ from: isoToDisplay(value.date_from), to: isoToDisplay(value.date_to) });
  const [lastDates, setLastDates] = React.useState({ from: value.date_from, to: value.date_to });
  if (value.date_from !== lastDates.from || value.date_to !== lastDates.to) {
    setLastDates({ from: value.date_from, to: value.date_to });
    setDateText({ from: isoToDisplay(value.date_from), to: isoToDisplay(value.date_to) });
  }
  const dateIso = { from: displayToIso(dateText.from), to: displayToIso(dateText.to) };
  const dateErrors: DateErrors = {};
  if (dateText.from !== "" && !dateIso.from) dateErrors.from = "Escribe una fecha válida con el formato dd/mm/aaaa.";
  if (dateText.to !== "" && !dateIso.to) dateErrors.to = "Escribe una fecha válida con el formato dd/mm/aaaa.";
  if (dateIso.from && dateIso.to && dateIso.to < dateIso.from) dateErrors.to = "La fecha final no puede ser anterior a la inicial.";

  const preset = distancePresetKey(value);
  const customDistance = preset === null && (value.distance_min_m !== null || value.distance_max_m !== null);

  function commitLocation() {
    const next = location.replace(/\s+/g, " ").trim().slice(0, 160) || null;
    if (next !== value.location) onChange({ ...value, location: next });
  }

  function changeDate(which: "from" | "to", display: string) {
    const text = { ...dateText, [which]: display };
    setDateText(text);
    const from = text.from === "" ? null : displayToIso(text.from);
    const to = text.to === "" ? null : displayToIso(text.to);
    const invalid = (text.from !== "" && !from) || (text.to !== "" && !to) || (from && to && to < from);
    if (!invalid && (from !== value.date_from || to !== value.date_to)) onChange({ ...value, date_from: from, date_to: to });
  }

  const fromId = `${idPrefix}-date-from`;
  const toId = `${idPrefix}-date-to`;
  const locationId = `${idPrefix}-location`;

  return (
    <div className="flex flex-col gap-5">
      <Group legend="Inscripciones">
        <Checkbox
          id={`${idPrefix}-open`}
          label="Solo con inscripciones abiertas"
          checked={value.registration_open}
          onCheckedChange={(checked) => onChange({ ...value, registration_open: checked === true })}
        />
      </Group>

      <Group legend="Fecha">
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
          <FormField id={fromId} label="Desde" errorText={dateErrors.from}>
            <DateInput
              id={fromId}
              value={dateIso.from ?? ""}
              invalid={Boolean(dateErrors.from)}
              aria-describedby={fieldDescribedBy(fromId, Boolean(dateErrors.from), false)}
              onValueChange={(_iso, display) => changeDate("from", display)}
            />
          </FormField>
          <FormField id={toId} label="Hasta" errorText={dateErrors.to}>
            <DateInput
              id={toId}
              value={dateIso.to ?? ""}
              min={dateIso.from ?? undefined}
              invalid={Boolean(dateErrors.to)}
              aria-describedby={fieldDescribedBy(toId, Boolean(dateErrors.to), false)}
              onValueChange={(_iso, display) => changeDate("to", display)}
            />
          </FormField>
        </div>
      </Group>

      <Group legend="Tipo de evento">
        <ul className="flex flex-col">
          {EVENT_TYPES.map((type) => (
            <li key={type.key}>
              <Checkbox
                id={`${idPrefix}-type-${type.key}`}
                label={type.label}
                checked={value.type.includes(type.key)}
                onCheckedChange={(checked) => onChange({ ...value, type: toggle(value.type, type.key, checked === true) })}
              />
            </li>
          ))}
        </ul>
      </Group>

      <Group legend="Distancia">
        <RadioGroup
          aria-label="Distancia"
          value={preset ?? (customDistance ? "custom" : "any")}
          onValueChange={(key) => {
            if (key === "custom") return;
            const chosen = DISTANCE_PRESETS.find((p) => p.key === key);
            onChange({ ...value, distance_min_m: chosen?.min ?? null, distance_max_m: chosen?.max ?? null });
          }}
          className="flex flex-col"
        >
          <RadioItem id={`${idPrefix}-distance-any`} value="any" label="Cualquier distancia" />
          {DISTANCE_PRESETS.map((p) => (
            <RadioItem key={p.key} id={`${idPrefix}-distance-${p.key}`} value={p.key} label={p.label} />
          ))}
          {customDistance ? <RadioItem id={`${idPrefix}-distance-custom`} value="custom" label="Rango de la dirección compartida" /> : null}
        </RadioGroup>
      </Group>

      <Group legend="Ubicación">
        <FormField id={locationId} label="Ciudad o estado" hideLabel helperText="Escribe y presiona Enter.">
          <TextField
            id={locationId}
            value={location}
            maxLength={160}
            enterKeyHint="search"
            autoComplete="address-level2"
            placeholder="Ciudad o estado"
            leadingIcon={<MapPin className="size-4" aria-hidden="true" />}
            aria-describedby={`${locationId}-helper`}
            onChange={(event) => setLocation(event.target.value)}
            onBlur={commitLocation}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitLocation();
              }
            }}
          />
        </FormField>
      </Group>

      <Group legend="Precio">
        <ul className="flex flex-col">
          {PRICE_OPTIONS.map((option) => (
            <li key={option.value}>
              <Checkbox
                id={`${idPrefix}-price-${option.value}`}
                label={option.label}
                checked={value.price.includes(option.value)}
                onCheckedChange={(checked) =>
                  onChange({ ...value, price: toggle<PriceFilter>(value.price, option.value, checked === true) })
                }
              />
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}
