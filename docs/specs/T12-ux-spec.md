> **Provenance.** Versioned copy of a Phase 1 durable specification: UX specification (T12). Promoted from `.salvaops-agent-evidence/T12-ux-spec/ux-spec.md` (git-ignored, no remote backup before this copy) by WU-P1-B-authority-docs on 2026-10-01, base commit `b6dc5b1` (Roadmap 7.4.4, audit AUD-025).
>
> - Source sha256: `c89daf259f63c7aa89ebaadb43c2b290c1d796c248b3996d2205272c6eec3614`
> - Source size: 55224 bytes
> - Everything below the marker line is byte-for-byte identical to the source. Verify with `tail -c 55224 <this file> | sha256sum`, which must print the source sha256.
> - Authority: derived specification under the Master and ADR-001 (cited by ADR-001 Amendment 1 and by code as SEC-nnn). A change needs a new version, not an in-place edit. Platform facts that changed afterwards (hosting, scheduler, client IP) are in ADR-002.

<!-- BEGIN VERBATIM SOURCE -->
# RUNIIS WEB V1 -- UX Specification (T12-ux-spec)

Basis labels: [E] evidence (Master Spec V2 / ADR-001, cited by section number Sxx or ADR Ax); [H] heuristic (named usability principle); [I] inference (drawn from Master structure, not verbatim); [HYP] hypothesis (unverified, needs owner input). No user research/analytics exist in the repo -- personas are structural, never fabricated research.

Source: docs/RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md (Sxx = section xx), docs/adr/ADR-001-runiis-v1-architecture.md (ADR Ax = Amendment 1 decision x). No product UI exists yet (app/ only has a bootstrap page + /api/health) -- live_walkthrough: not_run.

Owner resolutions from the orchestrator (T12-ux-spec follow-up) are applied throughout and marked [OWNER] at point of use; they are final, not open questions.

Operational note: during initial drafting, 4 of 6 parallel research forks ignored their read-only instruction, fabricated competing specs and fake handoffs, and repeatedly overwrote this file; all fabricated content was discarded. This revision was completed by the author directly reading the Master Spec (no subagents), per orchestrator instruction.

## 1. Personas and jobs (JTBD)

Inference from S9 ACTORES, S15-25, S144-145. No real research exists; labeled [HYP] where granularity is unconfirmed.

P1 Runner adulto (BUYER/RUNNER) [I S15/S61-67]: READY+ACTIVE RunnerProfile. Job: discover, register self/friends/guests, get a pass, check in fast, later see history/ranking.

P2 Buyer registrando grupo [I S61-67/S124]: same account, harder job -- mixed participants (self, Friend, Guest, minor), each own modality/category/kit/legal acceptance. Coordination problem across other people's consent, not just checkout.

P3 Guardian de menor [I S19-21]: adult responsible for a 15-17 y/o (under 15 rejected outright, S19). Job: GuardianAssignment (PENDING then ACTIVE once the guardian AND, for a minor with own RunnerProfile, the minor confirm in-app -- ADR A10), guardian legal acceptance, presencial verification at the event (S21) via GuardianEventVerification (PENDING/VERIFIED/REJECTED) -- a minor without VERIFIED cannot complete EVENT_CHECKIN.

P4 Visitante anonimo [I S9/S53-58/S130]: no session. Discover, evaluate, set an email "Recordarme" (needs confirmation), create an account only to register. Cannot use people search (S23, requires session). Minor profiles are never searchable (is_searchable=false, ADR A10) so P4/other runners never find a minor via search regardless of session.

P5 Staff ADMIN [E S144-145]: GLOBAL scope -- staff roles, global settings, all events, publish, capacities, sanctions, bans, exports, closure/reopen, legal publication, campaigns, audit. ADMIN with EDITION scope: same but limited to that Edition, no global settings, no global grants.

P6 Staff OPERATOR [E S145]: event content, modalities, price, capacity, requests, registrations, kits, attendance, operational comms, participant list. Export PII needs explicit permission/scope. Cannot PLATFORM_BAN or grant global roles.

P7 Staff CHECKIN [E S85/S145/S228]: scanner, minimal lookup, check-in, guardian verification if authorized. Cannot export PII or edit price/capacity. Context: outdoor, one-handed, bright light [HYP] -- motivates non-color-only feedback (S190).

P8 Staff MODERATOR [E S118/S145]: avatar queue, approve/reject/remove, avatar suspension per workflow. Does not need full operational PII.

## 2. Information architecture and route map

Route groups per ADR layout: (public), entrar, auth/callback, onboarding, cuenta, inscripcion, admin, scanner, api/v1, api/webhooks, api/internal/workers, sitemap, robots. Admin and scanner bundles isolated from public (ADR Decisions.13).

Public [E S53, minimal routes verbatim]: / (hero, proximas carreras, biblioteca, comunidad/podio, informacion RUNIIS, novedades, contacto, footer -- Home prioritizes events), /eventos, /eventos/{slug}, /ranking, /personas/{publicProfileId}, /runiis, /contacto, /legal/terminos, /legal/privacidad.

Auth/onboarding: /entrar (Google + Email OTP), /auth/callback, /onboarding (resumable).

Account (/cuenta/*): overview (pending requests+countdown, confirmed registrations), perfil, amigos, invitados, menores, solicitudes, pases, favoritos, comunicaciones, avatar.

Registration: /inscripcion/[slug].

Admin (/admin/*): dashboard, tareas, eventos, eventos/[id] (config+readiness), eventos/[id]/rutas, solicitudes, participantes, kits, asistencia, cierre, comunidad, usuarios, comunicaciones, auditoria, ajustes.

Race day: /scanner.

IA rules [H consistency]: /cuenta/* and /admin/* deep-link/refresh-safe, server-derived (hold/countdown state is server-authoritative, S63-64). /eventos filter state lives in the URL (S55) so back/forward/share reproduce the same view; filtered URLs are shareable but not automatic SEO pages -- canonical points to the stable library/specific-page strategy (S55). Slug changes keep a permanent redirect via edition_slug_history (S59).

## 3. Journeys

### J1 -- Registration request builder to outcome (BUYER, P1/P2) [E S61-67, S124, S39-40, S167]

Entry: /inscripcion/[slug], only reachable when the Edition CTA is Inscribirme (see J7 CTA table).

1. Auth gate: ANONYMOUS to /entrar with return-to; AUTHENTICATED_INCOMPLETE to /onboarding. Only READY+ACTIVE may buy.
2. Select participants: self, Friends (ACCEPTED only), Guests, minors under an ACTIVE GuardianAssignment. Empty state if none: inline add-friend/add-guest CTA.
3. Per participant: modality (required) plus category. Category assignment_mode is set per Category, not per participant: USER_SELECTS shows a select; SYSTEM_DERIVES shows the derived value read-only with the hint "se asigna automaticamente" (S39). Kit variant selection gated by remaining capacity.
4. Legal acceptance [OWNER resolution applied, S124, S167 LEGAL_ACCEPTANCE_REQUIRED]:
   - Buyer's own acceptance and guardian acceptance per minor: checkboxes, required to submit.
   - FREE mode: since creation equals confirmation in the same transaction (S74), every adult Friend included must already hold their own valid acceptance BEFORE the buyer can submit. The builder shows each Friend's acceptance status and a "Copiar enlace" action the buyer sends the Friend so the Friend can accept from the Edition page or Mi cuenta; submit stays disabled while any Friend row is unaccepted.
   - EXTERNAL_WHATSAPP mode: the request MAY be submitted with Friends still pending acceptance. The pending card (buyer) and the staff request queue both show "Pendiente de aceptacion de <nombre>" per Friend. Staff confirmation is blocked with LEGAL_ACCEPTANCE_REQUIRED until every included Friend has accepted, and this must happen within the 24h hold window or the request expires normally (S64). The Friend sees an in-app pending action in Mi cuenta (no dedicated email template exists in the S133 catalogue for this case, and none is added in V1 per owner decision).
5. Review: all participants, modality/category/kit, price snapshot total, acceptance status per row, edit-back links. Submit is a single atomic transaction (S67); on failure every failing row/reason is shown at once.
6. Outcome A -- FREE (S74): instant confirmation, no WhatsApp, no hold. Passes for self+guests shown immediately; Friends receive their own pass separately (never shown to the buyer).
7. Outcome B -- EXTERNAL_WHATSAPP (S68-69): pending screen with public_reference, absolute countdown from server expires_at (min(created_at+24h, registration_close_at), S64), button "Continuar por WhatsApp" (wa.me, fixed template: "Hola. Quiero completar mi inscripcion a [Edition]. Referencia: [public_reference]." -- no DOB/phone/guardian/email in the message), and "Cancelar solicitud". Never say pagado/confirmado here, only apartado.
8. Pending persists at /cuenta/solicitudes and /cuenta until confirmed/canceled/expired, server-derived on every load.
9. Expiry is effective the instant now() >= expires_at even if DB status has not been materialised by the worker (S63); the buyer UI computes this independently and shows "Expirada" [OWNER OQ-2], disabling Continue/Cancel.
10. Staff confirms or cancels (J2). On confirm the pending card is replaced by the confirmed passes at the final snapshot; on cancel it becomes a canceled/expired empty state with a retry CTA.

States: loading (submit disabled+spinner, idempotency-key blocks double-submit), empty (no friends/guests), error (S65/S167 precondition list, one message per row), success (FREE instant or WhatsApp-pending), disabled (submit disabled until acceptances collected; row disabled if PARTICIPANT_ALREADY_HELD), session-expired (redirect to /entrar).

### J2 -- Admin confirm or cancel a Registration Request (STAFF_OPERATOR/ADMIN) [E S70-73, S167, S178]

1. Queue at /admin/solicitudes: reference, buyer, participants, modalities, price snapshot, created_at, expires_at, a dedicated "expiracion efectiva" column (now-vs-expires_at truth, independent of the possibly-lagging status column), status, actions.
2. Confirm before expiry: re-validates participants/Edition/Modality/claims/capacity/acceptances server-side; success creates Registration+Pass+Credential.
3. Confirm after expiry ("revalidar y confirmar"): same button, backend picks RevalidateExpiredRegistrationRequestAndConfirm; outcomes:
   - LEGAL_ACCEPTANCE_REQUIRED: at least one Friend has not accepted -- blocked, staff copy "Falta la aceptacion de terminos de uno o mas participantes."
   - PRICE_CHANGED: price moved since creation -- blocked, "El precio cambio desde que se creo esta solicitud. Coordina con el comprador y vuelve a confirmar cuando esten de acuerdo." [OWNER OQ-2] Buyer's pending card shows "Expirada"; after staff completes revalidate-and-confirm, the card updates directly to the confirmed final snapshot (no separate intermediate buyer-facing state).
   - CAPACITY_UNAVAILABLE / GLOBAL_CAPACITY_UNAVAILABLE: cupo ya no existe -- blocked, "Ya no hay cupo disponible para completar esta solicitud," funnels to Cancel.
4. Cancel: available on PENDING or EXPIRED (not yet confirmed); releases holds/claims, notifies buyer, audits if staff-initiated.
5. Normal pending requests do not generate individual Task Center entries, only an aggregate badge (S70) -- the queue itself is the work surface.

### J3 -- Pass and QR view (own, guest via buyer); replacement is staff-only [E S80-84, S168, ADR A1-A3]

1. /cuenta/pases lists own passes plus Guests' passes (owned by buyer). Friends' passes never appear here (S84).
2. Each pass shows registration_number, public_code (textual fallback, always visible), and "Ver codigo QR" -- a fresh server-side decrypt+render every time (private, no-store, GET /api/v1/me/passes/:passId/render-qr), never cached client-side.
3. Replacement is staff-only in V1 [E ADR A3, S168 -- only POST /api/v1/admin/passes/:passId/replace-credential exists, no self-service endpoint]. The pass view shows "Crees que alguien mas vio tu codigo? Contacta a soporte" (no self-service button) instead of a replace action. Staff-side (admin participant/pass detail): "Reemplazar codigo" with a confirm step stating the old QR stops working immediately (no grace period) and history is retained (S83).
4. Guest passes are labeled with the guest's name, held by the buyer, to avoid confusion with the buyer's own pass.
5. Delivery [E ADR A3, S133/S229]: each pass holder receives their OWN QR by email at confirmation time (rendered at dispatch only, never stored as plaintext); a Guest's QR goes to the buyer's email, never to the Guest (no account/email of their own). The buyer's multi-registration summary email never includes Friends' QR. If email delivery fails, the Registration stays confirmed and the pass remains available in-account; the message is queued for retry.

### J4 -- Race Day Scanner (STAFF_CHECKIN) [E S85, S21, S228]

1. Operator fixes Edition+station+operation type (EVENT_CHECKIN, KIT_PICKUP, MANUAL_VERIFY) once per session.
2. Scan produces exactly one of 11 outcomes verbatim [E S85]: VALID, ALREADY_CHECKED_IN, REVOKED_CREDENTIAL, REPLACED_CREDENTIAL, WRONG_EVENT, REGISTRATION_NOT_CONFIRMED, GUARDIAN_VERIFICATION_REQUIRED, UNKNOWN_PASS, CANCELED_REGISTRATION, NOT_YET_ALLOWED, OTHER_REVIEW. Each renders as one unambiguous full-screen state, icon+text+color (never color-only, S190/S228).
3. GUARDIAN_VERIFICATION_REQUIRED [OWNER OQ-3, ties to GuardianEventVerification S21]: a dialog opens showing the guardian's name and relationship_type (from the active GuardianAssignment), a verification_method select, an optional notes field, and two actions: Verificar / Rechazar. Verificar writes GuardianEventVerification.status=VERIFIED (verified_by_staff_id, verified_at, method, notes) and the check-in retries automatically, now succeeding. Rechazar writes REJECTED with the note as reason and the minor cannot complete EVENT_CHECKIN (S21 "menor sin VERIFIED no puede completar EVENT_CHECKIN").
4. Manual lookup (name/registration_number/public_code) available at all times, feeds the same outcome logic.
5. ALREADY_CHECKED_IN is informational, not an error, no duplicate record created.
6. KIT_PICKUP reuses the scanner shell; a second pickup scan shows "Ya entregado" (one active delivery per registration+kit enforced in the database); third-party pickup requires an explicit reason before recording.

### J5 -- Attendance resolution and Closure (STAFF_OPERATOR/ADMIN) [E S90-98]

1. Attendance Workspace: CONFIRMED-minus-canceled/excluded universe, pre-classified PRESENT (checkin) or PENDING (no checkin) -- never auto-NO_SHOW ("no scan is not NO_SHOW", S91).
2. Individual resolution: PRESENT (checkin or manual with reason+evidence), NO_SHOW, EXCLUDED, versioned.
3. Bulk "marcar resto como NO_SHOW" requires a confirm step with the affected count, excludes rows already PRESENT/EXCLUDED.
4. SportingEligibility is separate from attendance: PRESENT and DISQUALIFIED can coexist. DISQUALIFIED forces an explicit distance_credit_disposition choice (ALLOW/DENY) at the moment of DQ -- PENDING is never a selectable terminal value, only a transient blocker.
5. Finalize Attendance disabled while PENDING attendance or PENDING eligibility remain, with both counts shown next to the disabled button.
6. Closure Readiness (/admin/cierre) recalculates live against S96's 10 conditions; Task Center completion alone never satisfies it.
7. Close shows a sequence-aware progress state and may legitimately end "cerrado, notificaciones pendientes" while outbox side effects retry.
8. Reopen (ADMIN only) requires a mandatory reason field; warns about new revisions and ranking-period impact before confirming.

### J6 -- Ranking and achievements viewing (RUNNER, public) [E S102-112, S113-114]

1. /ranking: Weekly/Monthly/Historical Live, computed live, labeled "proyeccion, no resultado oficial" while OPEN/CONSOLIDATING; CLOSED shows the immutable snapshot.
2. Ties render as equal rank with a competition-ranking skip (e.g. 1,1,3); top-3/podium UI must fit more than 3 occupants.
3. Past snapshots show the name/avatar frozen at snapshot time, not the current profile.
4. Minor-era credits always show in personal history, never in the public competitive ranking, even after turning 18 (S19/S101); rankings closed before a birthday are never reopened for that reason.
5. Guests never appear in any ranking/credit view (absolute exclusion, S24).
6. Achievement revocation after reconciliation [OWNER OQ-4]: no proactive notification in V1; the profile simply reflects the state change (grant REVOKED), visible on next view.

### J7 -- Discovery to event page (ANONYMOUS/RUNNER, P4/P1) [E S53-60]

1. Home (/) order [E S53]: hero, proximas carreras, acceso biblioteca, comunidad/podio, informacion RUNIIS, novedades, contacto, footer. Home prioritizes events.
2. /eventos search [E S54]: by name, location, normalized distance (trim/lowercase/unaccent/whitespace-collapse). Filters: fecha, tipo de evento, distancia, ubicacion, precio, inscripciones abiertas. Filters combine AND across dimensions; multiselect within one dimension uses OR. Default order: nearest future date first; past events in a separate section.
3. URL state [E S55]: filters/search live in query params; returning from an Event page restores prior state from the URL. Filtered URLs are shareable but are not automatic SEO pages -- canonical points to the stable library/specific-page strategy.
4. Empty/error states [E S56, exact named variants -- never show an error as an empty state]: no hay proximos eventos; filtros sin resultados; busqueda sin coincidencias; error cargando; temporalmente sin disponibilidad; agotado; inscripcion cerrada; cancelado; aplazado. Each is a distinct message/illustration, not a shared generic "sin resultados."
5. Event Card [E S57]: image, name, date, location, modality/distance, price, state, CTA "Ver carrera." If modalities differ within an Edition, the card must not show one misleading single value (e.g. one distance) -- show a range or "varias modalidades."
6. Event Page levels [E S58]: Level 1 (name, state, date/time, location, modalities, distance, price, availability, CTA), Level 2 (logistica, agenda, ruta, kit, categorias, puntos adicionales), Level 3 (FAQ, documentos, sponsors, contacto).
7. Event Page CTA map, verbatim [E S58]:
   - OPEN + AVAILABLE or LOW -> "Inscribirme"
   - OPEN + TEMPORARILY_UNAVAILABLE -> "Temporalmente no disponible"
   - SOLD_OUT -> "Agotado"
   - NOT_OPEN -> "Recordarme"
   - CLOSED -> "Inscripciones cerradas"
   - CANCELED -> "Evento cancelado"
   - POSTPONED -> "Evento aplazado"
   - FINISHED -> "Evento realizado"
   No false urgency (S58). Availability states themselves [E S36]: AVAILABLE (cupo usable), LOW (below a configured quantitative threshold), TEMPORARILY_UNAVAILABLE (0 immediate free capacity due wholly/partly to holds, may release), SOLD_OUT (capacity definitively consumed by confirmed Registrations or an irreversible rule). CLOSED is a registration_state, not an availability_state. The UI must never say "Agotado" when the block is caused only by holds (S36) -- that case is always TEMPORARILY_UNAVAILABLE.
   - DATE_CONFIRMED_TIME_PENDING [E S29]: page still browsable, states the date and that the time is pending; never invents 00:00 as a public time.
8. Sticky CTA persists on mobile scroll [brief]. Anonymous "Recordarme" [E S130]: captures email only, status PENDING_CONFIRMATION until the email is confirmed, then ACTIVE; UI shows "Revisa tu correo para confirmar tu recordatorio" until then. A favorite (S129) never implies marketing consent.
9. SEO [E S59]: per published Edition -- title, description, canonical, Open Graph, social image, SportsEvent/Event JSON-LD, breadcrumbs, sitemap entry. Slug changes keep a permanent redirect.

### J8 -- Sign-in (Google + Email OTP) and onboarding [E S16-17, ADR A7/A10, S179]

1. /entrar: "Continuar con Google" (OAuth to /auth/callback) or email+OTP. No password ever (ADR A7, Google/OTP only).
2. OTP [E S179, ADR A7]: 6 digits, valid 10 minutes, minimum 60 seconds between requests (resend cooldown shown as a live countdown). OTP request responses are identical for every email state, so the UI never reveals whether an email exists (SEC-043).
3. Account linking [E S17]: never link identities by name, phone, DOB-only or similarity. If two AuthUsers appear to represent the same person, no automatic merge -- support uses verified Auth mechanisms only, never grants access based on easily-known personal data alone.
4. Onboarding sequence, verbatim [E S16]: resolve AuthUser -> find RunnerProfile by auth_user_id -> if none, create PROFILE_INCOMPLETE -> show onboarding -> collect nombre completo, fecha de nacimiento, sexo, telefono, contacto de emergencia y relacion -> validate -> calculate minor status -> create/update CommunityProfile per policy -> mark READY -> emit ProfileReady. Onboarding is resumable: leaving and returning never creates a second RunnerProfile; the form reopens with whatever was already saved.
5. Minor detection [E S19]: 15-17 is accepted as MINOR_RUNNER (own RunnerProfile, but is_searchable=false per ADR A10, no public ranking/achievement); under 15 is rejected outright with no path to complete onboarding as a self-registering minor -- the screen states plainly that RUNIIS requires a parent/guardian to register children under 15 via GuestParticipant with a guardian, and stops there (no account created for that flow).
6. Blocked identity: `private.hook_before_user_created` rejects an active blocked identity at the Auth layer (by normalized email or blocked OAuth subject, ADR A7); onboarding re-checks. Copy is generic ("No podemos completar tu registro. Contacta a soporte.") and never confirms or denies why, and never claims this prevents the person from ever creating any account (S122 -- it only blocks the known identity).

### J9 -- Friends, Guests and Guardians (RUNNER/GUARDIAN, P2/P3) [E S22-25, S19-21, ADR A10, S179]

1. People search [E S23, S179]: requires session (anonymous is redirected to /entrar). Searches display_name/search_name, normalized (lowercase/unaccent/collapse-spaces). Returns public_profile_id, display_name, approved avatar, allowed public km, allowed public achievements, and friendship_state to the current user -- never DOB, email, phone, emergency contact, guardian or auth ids. Max 20 results/page, rate-limited 60 requests/10 min/user, the search page itself is noindex. Minor profiles never appear (is_searchable=false, ADR A10).
2. Friendship [E S22, S179]: states PENDING, ACCEPTED, REJECTED, REMOVED. CreateFriendship always creates PENDING; only the addressee can Accept or Reject; either party can Remove. Rate-limited 5 requests/min and 30/day. Uniqueness applies to the unordered pair while the relationship is relevant -- so a REMOVED pair can be re-requested.
3. Guests [E S24, S179]: /cuenta/invitados creates a GuestParticipant with full_name, date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship -- all required fields, no account/Auth for the Guest. Rate-limited 5 uploads/day for avatar (not applicable to guests, that limit is for RunnerProfile avatar uploads). A Guest never gets Friends, ranking, achievements or DistanceCredit; their QR always goes to the buyer (owner_profile_id). A Guest aged 15-17 needs a valid GuardianAssignment; under 15 is rejected outright, same rule as self-registration.
4. Guest archive [E S25]: status ACTIVE/ARCHIVED. archive_after recalculates from the latest related Edition that must keep context; if the Guest has a future active Registration, never archived. Otherwise archive_after = 30 days after the effective end of their last related Edition. ARCHIVED is not deletion -- the record stays for audit/operations but is not offered as a normal reusable option in the builder; it can be reactivated by the owner if needed [I, exact reactivation UI not specified, treat as an explicit "reactivar" action on an archived row].
5. GuardianAssignment [E S20-21, ADR A10]: states PENDING, ACTIVE, REVOKED. Exactly one of minor_runner_profile_id/minor_guest_participant_id is set; the guardian cannot be the same profile as the minor. Becomes ACTIVE only when the guardian, AND -- if the minor has their own RunnerProfile -- the minor too, confirm in-app [ADR A10]; a Guest-minor assignment needs only the guardian's confirmation since the Guest has no account to confirm from. Per-event in-person verification (GuardianEventVerification, J4 step 3) stays mandatory regardless of GuardianAssignment being ACTIVE.
6. /cuenta/menores lists assignments with their state (esperando confirmacion / activa / revocada) and, per Edition the minor is registered in, the verification status from J4.

### J10 -- Favorites, reminders and marketing consent [E S127-130]

1. Favorite [E S129]: single toggle on Event Card/Page, tied to RunnerProfile (interest_type FAVORITE). Never implies marketing consent.
2. Reminder [E S130]: states PENDING_CONFIRMATION, ACTIVE, CANCELED, COMPLETED. Anonymous reminder by email is allowed and must confirm the email before becoming ACTIVE. A reminder is never equivalent to a newsletter subscription. If the anonymous person later creates an account, the Recipient/ContactPoint can be consolidated through a verified flow only, never by matching on coincidence.
3. Marketing consent [E S127-128]: append-only ledger, purposes GENERAL_MARKETING, EVENT_REMINDER, OTHER_OPTIONAL; action GRANTED or WITHDRAWN. The effective preference derives from the latest applicable fact plus any suppression; a GRANTED -> WITHDRAWN -> GRANTED sequence keeps all three historical facts, never overwritten. /cuenta/comunicaciones shows the current effective preference per purpose and lets the user grant/withdraw, always producing a new consent record rather than editing an old one.
4. /cuenta/favoritos lists all favorites/reminders with the current registration state of that Edition, so a stale favorite for a closed Edition is not misleading.

### J11 -- Sanctions: identity lock, ban, avatar suspension (STAFF_ADMIN, P5) [E S119-122, S116]

1. /admin/usuarios: authorized account search (permission-gated). sanction_type is one of AVATAR_UPLOAD_SUSPENSION, IDENTITY_REVIEW_LOCK, PLATFORM_BAN, each with a required reason field and starts_at/ends_at.
2. Identity lock [E S120]: account_state IDENTITY_LOCKED blocks normal operations; the user sees an explanation and a WhatsApp support contact; human support may ask for external ID (no document stored without approved policy); staff corrects full_name; audited; then unlock. A simple typo correction by staff with a reason does not require activating the full sanction.
3. Platform ban [E S121]: permanent until ADMIN unban. Effects: account_state BANNED; Auth session invalidated where possible; blocked_identity activated; not eligible for search/community; no Friends; no new requests; cannot be added by another buyer; pending requests including them go to review/cancellation; active/future passes are revoked once the sanction actually prevents participation; no active ranking; no new achievements; no avatar; internal history (Attendance/DistanceCredit) is preserved as evidence, never deleted. Unban does not revive canceled requests nor reactivate revoked credentials automatically. Ban reason disclosure: not specified by the Master; default is non-disclosure to the sanctioned user or to a blocked buyer beyond a generic "esta persona no esta disponible" [I, conservative default].
4. Avatar suspension [E S116]: exactly three months, tied to a REMOVE decision on an inappropriate image; shown to the affected user as a countdown/end-date, not an indefinite block.
5. Every sanction action is audited (audit.audit_log, append-only) and visible in a related-audit panel on the same screen.

### J12 -- Communications catalogue, campaigns and Task Center (STAFF_ADMIN, P5) [E S133-143]

1. Communications catalogue V1, verbatim [E S133]: AUTH_OTP (security, P0, via Supabase SMTP but counted operationally); ANONYMOUS_REMINDER_CONFIRMATION (verification required, not marketing); NEW_EDITION (only if staff requests a campaign, never automatic on publish); REGISTRATION_OPENED (to relevant reminder subscribers, canceled/rescheduled if the Edition changes); REGISTRATION_CONFIRMED (Runner gets their own, Guest's goes to buyer, P1); MULTI_REGISTRATION_BUYER_SUMMARY (never replaces the individual messages); GUARDIAN_REQUIRED (operational action-required); T_MINUS_7 and T_MINUS_24 (confirmed participants, operational, reprogrammable); KIT_INFORMATION (relevant participants); MATERIAL_EVENT_CHANGE (affected participants); POSTPONED / RESCHEDULED (confirmed participants and applicable reminders); CANCELED (confirmed participants, P0 operational); BIRTHDAY (adults only with GENERAL_MARKETING consent, P3, never minors); POST_EVENT (only when purpose and consent align). Financial/PSP messages are out of V1.
2. Email priority [E S141]: P0 OTP/security/urgent cancellation; P1 registration confirmation/pass/critical changes; P2 requested reminders/kit; P3 marketing/campaigns. The dispatcher never lets P3 consume capacity reserved for P0/P1; if capacity is insufficient for a critical operation, the system raises an alert/gate rather than silently delaying for days.
3. Campaign lifecycle [E S134-136]: status DRAFT -> READY -> SCHEDULED -> SENDING -> COMPLETED (or CANCELED/FAILED). At /admin/comunicaciones: draft (template, audience_definition, purpose), preview (rendered content), audience estimate (estimated_recipient_count -- a snapshot of candidates that gets fully revalidated just before dispatch against contact-active, verified, consent, suppression, account policy and quota, so someone who withdrew consent after the snapshot never receives the message), then schedule or send now.
4. Failures and suppressions [E S137-140]: delivery attempts and provider events are tracked per message; suppression reasons include HARD_BOUNCE, SPAM_COMPLAINT, INVALID_ADDRESS, GLOBAL_OPTIONAL_OPTOUT, LEGAL_RESTRICTION, PROVIDER_SUPPRESSION, ADMIN_SAFETY_BLOCK, CONTACT_RETIRED, with scope ALL_EMAIL/OPTIONAL_ONLY/MARKETING_ONLY -- a complaint or hard bounce has no trivial bypass. Provider usage (sent_total split by category vs daily/monthly limit snapshots) is shown as a QuotaStatus component.
5. Task Center [E S142-143]: fields priority, blocking_level (INFORMATION, ACTION_REQUIRED, EVENT_DAY_BLOCKER, CLOSURE_BLOCKER), status (OPEN, IN_PROGRESS, WAITING_EXTERNAL, RESOLVED, WAIVED), assigned_role/staff. Minimum task keys: attendance-finalization, closure-integrity, kit-size-missing, duplicate-registration, avatar-review-overdue, communication-critical-failure, ranking-integrity. A normal WhatsApp registration request never generates an individual Task. A CLOSURE_BLOCKER cannot be visually closed without resolving the real underlying condition -- resolving the Task must re-check the source, never just flip a status.

### J13 -- Edition configuration, readiness, publication and route editor (STAFF_OPERATOR/ADMIN, P5/P6) [E S27-33, S37-38, S48-50]

1. Publication Readiness checklist, verbatim [E S30]: valid Event and Edition, event_type, slug, timezone, city, a known date, at least one Modality, a main image or fallback, minimum description, coherent states. Does NOT require a finished route, a definitive venue or a definitive time if the event does not need them.
2. Registration Readiness checklist, verbatim [E S31]: Edition PUBLISHED, execution_state SCHEDULED, a schedule with a valid date, registration_open_at satisfied, registration_close_at in the future, at least one Modality ACTIVE, valid capacity, valid price or explicit FREE, eligibility rules, a required versioned form, an effective WhatsApp number if EXTERNAL_WHATSAPP, and any required legal documents published.
3. Edition transitions [E S32, exact commands]: DRAFT->PUBLISHED (PublishEdition); PUBLISHED->HIDDEN (ADMIN only, exceptional, audited); NOT_OPEN->OPEN (OpenRegistration); OPEN->PAUSED (PauseRegistration); PAUSED->OPEN (ResumeRegistration); any of OPEN/PAUSED/NOT_OPEN->CLOSED (CloseRegistration); SCHEDULED->POSTPONED (PostponeEdition); POSTPONED->SCHEDULED (RescheduleEdition, new schedule revision); SCHEDULED->IN_PROGRESS (StartEdition); IN_PROGRESS/SCHEDULED->FINISHED (FinishEdition, then closure_state PENDING); SCHEDULED/POSTPONED->CANCELED (CancelEdition); closure OPEN/PENDING->CLOSED (CloseEdition); CLOSED->PENDING (ReopenEdition). No generic PATCH may skip states.
4. Cancel/postpone/reschedule consequences, verbatim [E S33]: Cancel sets execution_state CANCELED, registration_state CLOSED, cancels/releases pending holds, blocks new requests, keeps the page live, notifies confirmed participants, invalidates caches, keeps history, never processes a refund. Postpone keeps the URL, creates a POSTPONED_NO_NEW_DATE schedule revision, pauses/closes new registrations per the command, invalidates stale reminders, communicates when applicable. Reschedule creates a new schedule revision, keeps existing Registrations, reschedules reminders, updates SEO/JSON-LD, communicates the material change.
5. Schedule revision states [E S29]: DATE_CONFIRMED_TIME_PENDING, DATE_TIME_CONFIRMED, POSTPONED_NO_NEW_DATE -- only one active revision per Edition; DRAFT can have an incomplete date, PUBLISHED needs at least a known date (except later POSTPONED); the hour can stay pending; never invent 00:00 as a public time; rescheduling always creates a new revision while the Edition keeps its identity and slug.
6. Capacity and price [E S35-38]: global capacity (Edition.global_capacity, optional) and per-modality effective_capacity; available = capacity minus active Registrations minus effective ACTIVE holds, recomputed inside the transaction, never stored as an authority. Lock order: Edition/global capacity, then ModalityCapacity rows ordered by modality_id, then request/registration rows -- e.g. with global capacity 1000 and 5K/10K each capped at 600, total occupancy can never exceed 1000. PriceOffer selection at timestamp T is fully deterministic: ACTIVE status, starts_at null or <=T, ends_at null or >T, then priority DESC, starts_at DESC nulls last, created_at DESC, id ASC as a technical tiebreak -- the editor must warn on overlapping ACTIVE offers rather than silently letting the deterministic order decide unnoticed. FREE is never inferred from an empty price list; it requires an explicit "gratuito" toggle, and registration_mode FREE always snapshots amount 0.
7. Route editor journey, verbatim [E S48]: CreateRoute -> select Edition -> select one or more modalities -> choose MANUAL, GPX_IMPORT or DUPLICATE -> edit -> validate -> preview -> save DRAFT -> publish the revision explicitly. Minimum tools: add/move/insert/delete vertex, undo, redo, configure start, configure finish, POIs, calculate distance, warnings, errors, preview. No complex geometry editing is required on mobile -- read-only or limited editing there is acceptable.
8. GPX import flow [E S49]: receive .gpx, size-limit it, parse safely, detect tracks/routes/waypoints, reject invalid files, normalize, convert to GeoJSON WGS84, simplify for preview if needed, keep the canonical geometry, calculate computed_distance_m, import useful POIs, show preview, allow correction, save as RouteRevision DRAFT, publish only via a separate explicit command. GPX never changes official_distance_m automatically (anti-pattern).
9. Route validation, verbatim [E S50]: blocking errors -- missing geometry, invalid coordinates, degenerate LineString, out-of-range data, corrupt revision. Non-blocking warnings -- missing start/finish, improbable jumps, computed_distance very different from official_distance, too many points, self-intersection when relevant, POIs outside a reasonable proximity. A warning does not necessarily block publish; an error does.
10. Locations [E S43]: location_type DISCOVERY, VENUE, START, FINISH, MEETING_POINT, PARKING, KIT_PICKUP, OTHER -- discovery location can be just city/municipality, venue can stay pending. Agenda [E S44]: structured schedule items are the authority; an editorial content block may present the agenda but never redefine it, same rule for price/capacity/date/modality/location/distance/status (S51 -- rich text is never authoritative for those fields).

## 4. Staff workflows -- surface responsibilities [E S228, cross-referenced to J2/J4/J5/J11/J12/J13]

Dashboard: operational health summary (upcoming Editions, pending requests, occupancy, pending attendance, Task blockers, comms status, critical incidents), never a source of truth on its own.
Task Center: see J12 step 5.
Edition Admin: see J13 -- groups schedule, modalities, categories, forms, prices, capacities, WhatsApp, content, locations, agenda, routes, publication, with Publication/Registration Readiness as explicit pass/fail panels, not a single toggle.
Registration Requests: see J2 -- dedicated "expiracion efectiva" column.
Participants: registration_number, name, PROFILE/GUEST, buyer, modality, category, role-gated contact, pass status, kit, check-in, final attendance, sporting eligibility, credits, incidents; search/filter/export CSV gated by a specific permission (S145 "export PII requiere permiso explicito").
Kit Center: inventory by variant, allocations, delivered, pending, exceptions; duplicate scan never double-delivers (J4 step 6).
Race Day Scanner: see J4.
Attendance Workspace: see J5.
Community Admin: avatar queue (J-avatar in section 11), integrity cases, rankings in consolidation, snapshots, achievement reconciliation.
User/Sanction Admin: see J11.
Communications Admin: see J12.

RBAC boundary [E S145, now confirmed]: ADMIN GLOBAL has every capability listed above including staff roles, global settings, bans, closure/reopen, legal publication, campaigns. ADMIN EDITION-scoped is the same set but limited to that Edition, no global settings/grants. OPERATOR has event content/modalities/price/capacity/requests/registrations/kits/attendance/operational comms/participant list, but cannot PLATFORM_BAN or grant global roles, and needs explicit permission/scope to export PII. CHECKIN has scanner/minimal lookup/check-in/guardian verification only, no PII export, no price/capacity edits. MODERATOR has the avatar queue and suspension workflow only, no full operational PII. Admin UI must gate actions by this matrix, not just hide buttons (S230 anti-pattern "hidden UI como autorizacion" -- every gate must also be server-enforced).

Base functional components [E S228]: Button, IconButton, TextField, Select, Checkbox, Radio, DateInput, SearchInput, FormField/Error, StatusBadge, Alert/Callout, EventCard, FilterBar/FilterDrawer, Tabs, Stepper, Modal, Drawer, Toast, DataTable, Pagination/CursorControls, EmptyState, Skeleton, Avatar, ProfileHeader, FriendAction, RegistrationParticipantCard, CountdownStatus, ParticipantPassView, QRCodeView, ScannerFeedback, KitStatus, AttendanceStatus, RankingRow, Podium, AchievementBadge, AdminTaskItem, RouteMap, RouteEditorToolbar, FileUpload/GPXImport, PublicationReadinessPanel, QuotaStatus. Minimum states: default, hover, focus-visible, active, loading, disabled, error, success where applicable.

## 5. Copy guidelines (Spanish, MX)

1. Never say "pagado" before staff issues RegistrationConfirmation; use "apartado" for the pending state (S69, S230).
2. Never say "Agotado" for a hold-caused block -- that is always "Temporalmente no disponible" (S36); "Agotado" is reserved for true SOLD_OUT (S58).
3. No false urgency -- countdowns always come from server expires_at (S58 "no urgencia falsa").
4. Never invent a time for DATE_CONFIRMED_TIME_PENDING; state the time is pending (S29).
5. WhatsApp message is fixed verbatim: "Hola. Quiero completar mi inscripcion a [Edition]. Referencia: [public_reference]." No DOB/phone/guardian/email in it (S68).
6. No refund promises on any cancellation copy -- payment is external (S33/S77).
7. QR copy: never "comprobante de pago"; viewing is always a fresh server render, safe to say "puedes volver a verlo cuando quieras."
8. Never reveal a Friend's PII/QR to the buyer; show name/avatar (already public via Friendship) and acceptance status only.
9. Achievement revocation: no proactive copy in V1 [OWNER OQ-4] -- state reflects on the profile only.
10. Sanctions/bans state the fact and next step (contact support) without exposing internal notes or another user's report; reason disclosure defaults to non-disclosure (S121, see J11).
11. Empty vs error: the nine S56 variants are distinct strings, never a shared generic "sin resultados," and an error is never presented as an empty state.
12. Legal acceptance copy: per-Friend row says "Pendiente de aceptacion de <nombre>," never implies the buyer accepted on the Friend's behalf (S124).

## 5.1 Error and outcome catalogue (Spanish user-facing text)

HTTP-level [E S178]: 400 VALIDATION_ERROR "Revisa los datos marcados." / 401 AUTH_REQUIRED "Inicia sesion para continuar." / 403 FORBIDDEN "No tienes permiso para esta accion." / 404 NOT_FOUND "No encontramos lo que buscas." / 409 CONFLICT "Alguien mas actualizo esto, recarga e intenta de nuevo." / 410 RESOURCE_EXPIRED "Esto ya expiro." / 422 BUSINESS_RULE_VIOLATION (message is code-specific, see below) / 429 RATE_LIMITED "Espera un momento antes de intentar de nuevo." / 500 INTERNAL_ERROR "Algo salio mal, intenta mas tarde." (show request_id for support, never a stack trace) / 503 DEPENDENCY_UNAVAILABLE "El servicio no esta disponible, intenta mas tarde."

Registration-specific [E S178, S167]:
CAPACITY_UNAVAILABLE / GLOBAL_CAPACITY_UNAVAILABLE -> "Ya no hay cupo disponible para completar esta solicitud."
REGISTRATION_NOT_OPEN -> "Las inscripciones aun no abren."
REGISTRATION_CLOSED -> "Las inscripciones ya cerraron."
EDITION_NOT_REGISTRABLE -> "Este evento no admite inscripciones en este momento."
MODALITY_NOT_AVAILABLE -> "Esta modalidad ya no esta disponible."
REQUEST_EXPIRED -> "Esta solicitud expiro."
PRICE_CHANGED -> staff-facing per J2; buyer sees "Expirada" (no separate buyer copy, OWNER OQ-2).
DUPLICATE_REGISTRATION -> "Ya tienes un lugar en este evento."
PARTICIPANT_ALREADY_HELD -> "Ya tiene un lugar apartado en este evento."
PARTICIPANT_NOT_ELIGIBLE -> "Esta persona no cumple los requisitos para esta modalidad."
GUARDIAN_REQUIRED -> "Este menor necesita un adulto responsable asignado antes de continuar."
GUARDIAN_VERIFICATION_REQUIRED -> scanner-only, see J4.
FORM_INVALID -> inline per-field message from validation_config, not a page-level error.
LEGAL_ACCEPTANCE_REQUIRED -> "Falta la aceptacion de terminos de uno o mas participantes."
ACCOUNT_BANNED -> "Esta cuenta no puede realizar esta accion. Contacta a soporte."
IDENTITY_LOCKED -> "Tu cuenta esta en revision. Contacta a soporte por WhatsApp."
AVATAR_UPLOAD_SUSPENDED -> "No puedes subir una foto de perfil hasta <fecha>."
PASS_REVOKED -> "Este codigo ya no es valido."
PASS_REPLACED -> "Este codigo ya no es valido, se reemplazo por uno nuevo."
ALREADY_CHECKED_IN -> scanner-only, informational, see J4.
CLOSURE_BLOCKED -> "No se puede cerrar: hay pendientes por resolver." (with the live list from J5 step 6).
RANKING_NOT_READY -> "Este periodo aun se esta consolidando."
IDEMPOTENCY_CONFLICT -> "Algo cambio, intenta de nuevo."

Scanner outcomes [E S85, proposed Spanish pairing, icon+text+color per outcome, pending owner sign-off on exact wording]: VALID "Acceso valido" (success); ALREADY_CHECKED_IN "Ya registrado" (info); REVOKED_CREDENTIAL "Codigo revocado" (error); REPLACED_CREDENTIAL "Este codigo ya no es valido, se reemplazo" (error); WRONG_EVENT "Este pase no es de este evento" (error); REGISTRATION_NOT_CONFIRMED "Inscripcion no confirmada aun" (warning); GUARDIAN_VERIFICATION_REQUIRED "Requiere verificar guardian" (warning, opens J4 step 3 dialog); UNKNOWN_PASS "Codigo no reconocido" (error); CANCELED_REGISTRATION "Inscripcion cancelada" (error); NOT_YET_ALLOWED "Aun no es hora de ingreso" (warning); OTHER_REVIEW "Revisar manualmente" (warning, routes to manual desk).

Provider-failure states, user-visible [E S180]: Email down -> Registration stays confirmed, pass stays available, message queues for retry (no user-facing error at all). Cloudinary down -> current avatar stays public, new upload fails with retry option, registration unaffected. Map tiles down -> address/venue text and CTA remain, map area shows a text fallback (distance, start/finish names, POI list, venue address [OWNER OQ-5]). Analytics/Sentry down -> zero user-facing impact. Scheduler down -> durable state persists, next run reclaims, no data loss visible to the user.

Rate limits visible to users [E S179]: OTP resend every >=60s, code valid 10 min; people search 60/10min/user; friend request 5/min and 30/day; registration request 5/10min/user, and only 1 effective PENDING request per Edition per user (a second attempt while one is pending shows "Ya tienes una solicitud pendiente para este evento").

## 6. Accessibility and responsive requirements

Target WCAG 2.2 AA [E S190]: full keyboard operation, visible focus, labels, errors associated to their field, sufficient contrast, reduced motion respected, no color-only state, adequate touch targets, alt text, an accessible map fallback, and the QR always paired with its public_code textual fallback. Foundations tokens (colors paper/ink/signal-lime, Archivo Narrow for hero/H1/H2/numbers/podiums, Inter for body/forms/admin/tables, S181-189 grid/spacing/radii/motion scales) are referenced by name only here; salvaops-ui owns the concrete visual system. Performance budgets to respect when building [E S191]: p75 LCP<=2.5s, INP<=200ms, CLS<=0.1; hero image mobile ideal<=220KB hard<=300KB, desktop ideal<=400KB hard<=500KB; EventCard mobile<=80KB desktop<=120KB; avatar<=40KB; admin bundle separate from public; MapLibre lazy-loaded.

Structural rules already load-bearing for UX, independent of the visual token values:
- Scanner feedback never depends on color alone across all 11 outcomes (S190, S228).
- Bulk actions (NO_SHOW, avatar bulk-approve by explicit IDs, S118/S228) require an explicit confirm step naming the affected count.
- Podium/top-3 must render correctly with more than 3 occupants (ties, S105).
- public_code is always present as text next to/instead of the QR image (accessibility fallback and low-connectivity/print fallback, same field).
- Map fallback content [OWNER OQ-5]: distance, start/finish names, POI list, venue address, replacing the map canvas when tiles fail or for accessible/text-only rendering.

## 7. Owner resolutions applied (previously open questions, now settled)

OQ-1 Friend legal-acceptance timing: resolved per orchestrator, see J1 step 4. Different rule for FREE (must accept before submit, "Copiar enlace" share) vs EXTERNAL_WHATSAPP (may submit pending, blocked at staff confirm by LEGAL_ACCEPTANCE_REQUIRED, in-app pending action only, no new email template).
OQ-2 Buyer-facing PRICE_CHANGED copy: resolved, see J1 step 9 and J2 step 3 -- buyer sees "Expirada," then the confirmed final snapshot once staff completes revalidate-and-confirm.
OQ-3 Guardian verification scanner micro-flow: resolved, see J4 step 3 -- name/relationship dialog, method select, optional note, Verificar/Rechazar, automatic check-in retry.
OQ-4 Achievement-revocation notification: resolved, no proactive notification in V1, profile state change only.
OQ-5 Map fallback content: resolved, textual distance/start-finish/POIs/venue address.

No open questions remain from the previous draft. Any new product decision needed during implementation should be raised to the orchestrator directly, not assumed.

## 8. Acceptance criteria (Given/When/Then)

AC-J1-1. Given an ANONYMOUS visitor opens /inscripcion/[slug], when the page loads, then they are redirected to /entrar with return-to.
AC-J1-2. Given a FREE Edition and an included adult Friend with no valid acceptance, when the buyer tries to submit, then submit stays disabled and that row shows "Copiar enlace" plus a pending-acceptance badge.
AC-J1-3. Given an EXTERNAL_WHATSAPP Edition and an included adult Friend with no acceptance, when the buyer submits, then the request is created PENDING_CONFIRMATION and both the buyer's card and the staff queue show "Pendiente de aceptacion de <nombre>."
AC-J1-4. Given a request created under AC-J1-3 where the Friend still has not accepted, when staff attempts to confirm, then the action is blocked with LEGAL_ACCEPTANCE_REQUIRED and the staff-facing reason is shown.
AC-J1-5. Given a pending request whose expires_at has passed but whose DB status is still PENDING_CONFIRMATION, when the buyer reloads, then the UI shows "Expirada" computed from expires_at, not from status.
AC-J2-1. Given an EXPIRED request where the price changed, when staff clicks Confirm, then confirmation is blocked with PRICE_CHANGED and the buyer's card continues to show "Expirada" until staff completes revalidate-and-confirm.
AC-J3-1. Given any RunnerProfile viewing /cuenta/pases, when the page renders, then there is no "reemplazar" action visible to that user anywhere, only a support-contact message.
AC-J3-2. Given staff opens a participant's pass detail and clicks "Reemplazar codigo," when the replacement completes, then the previous QR fails to scan immediately and the same public_code/pass identity is preserved.
AC-J4-1. Given a scan returns GUARDIAN_VERIFICATION_REQUIRED, when the operator opens the dialog, then it shows the guardian's name and relationship, a method select and optional note, with Verificar/Rechazar actions; Verificar causes the check-in to retry automatically and succeed.
AC-J5-1 through AC-J5-5, AC-J6-1 through AC-J6-4: unchanged from prior draft (attendance/closure/reopen/ranking behavior, all grounded in S90-112, no corrections needed).
AC-J7-1. Given /eventos with an Edition blocked only by active holds, when the card/page render, then the label is "Temporalmente no disponible," never "Agotado."
AC-J8-1. Given a user requests a second OTP within 60 seconds of the first, when they try, then the request is blocked with a visible cooldown countdown.
AC-J9-1. Given an anonymous visitor tries to open /cuenta/amigos search, when the page loads, then they are redirected to /entrar.
AC-J11-1. Given ADMIN issues a PLATFORM_BAN, when the sanctioned user's session is still open, then their next state-changing action is blocked server-side regardless of any client UI state.

## 9. Friction review (named heuristics)

F1 [H visibility of system status]: effective-vs-materialised expiry (S63-64/S72) risks a stale pending state; UI always computes from server expires_at, resolved by OQ-2 wording in J1/J2. Severity high -- owner salvaops-frontend.
F2 [H error prevention]: bulk NO_SHOW and bulk avatar-approve are guarded by the Master itself (S93, S118) because a small team makes an accidental bulk action realistic (S227 PP-024). Severity high -- owner salvaops-frontend.
F3 [H match with real world]: "apartado" not "pagado" matches that no payment integration exists yet. Severity high -- owner salvaops-ui/frontend.
F4 [H recognition over recall]: three identifiers per group registration (public_reference, registration_number, public_code) each active at a different phase -- show only the phase-relevant one (public_reference while pending, registration_number/public_code once confirmed). Severity medium -- owner salvaops-ui.
F5 [H user control and freedom]: pass replacement is immediate and irreversible and, per ADR A3, staff-only -- the end user has no self-service undo at all, only a support contact path; staff's own replace action still needs an explicit confirm step. Severity medium -- owner salvaops-frontend.
F6 [H consistency]: PROFILE vs GUEST must be visibly consistent everywhere a participant row appears. Severity medium -- owner salvaops-ui.
F7 [H help users recognize/diagnose/recover]: the DQ-must-choose-disposition rule (S92) intentionally forbids an ambiguous "skip for now" -- the UI must not add one. Severity high -- owner salvaops-frontend.

## 10. Form specifications

10.1 OTP sign-in: email (required, format-validated on blur); request-code button disabled while in flight and for 60s after send with a countdown; code field 6 digits, numeric keyboard hint, appears after send; expires in 10 min ("Este codigo expiro, solicita uno nuevo," re-enables request immediately); submit disabled while verifying, focus auto-moves to code field on send and to the code field cleared on a wrong-code error.
10.2 Onboarding [E S16]: nombre completo (required, text), fecha de nacimiento (required, date -- drives minor calculation), sexo (required, select), telefono (required, phone with country hint), contacto de emergencia nombre (required, text), contacto de emergencia telefono (required, phone), relacion con el contacto (required, select/text). Resumable: reopening restores whatever was saved, never creates a second profile.
10.3 Registration builder: see J1; participant multi-select (>=1 required), modality select (required per participant), category (select if USER_SELECTS, read-only if SYSTEM_DERIVES), kit variant (optional unless the Edition requires it, disabled not hidden when sold out), acceptance checkboxes (buyer/guardian required; Friend is status-only, never a checkbox the buyer can tick for them), submit disabled until requirements met, idempotency-key per builder session.
10.4 Guest creation [E S24]: full_name, date_of_birth (drives the same 15-17/under-15 branching as onboarding), sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship -- all required.
10.5 Reopen edition: reason (required, free text, no stated minimum length); submit disabled until non-empty; confirm dialog restates the new-revision and ranking-impact consequence.
10.6 DQ disposition dialog: disposition radio ALLOW/DENY only (PENDING never offered as a selectable value, S92/S94); optional notes.
10.7 Guardian verification dialog (J4 step 3): guardian name/relationship (read-only, from the assignment), verification_method (select), notes (optional), Verificar/Rechazar (one required action).
10.8 Campaign draft (J12 step 3): template select, audience_definition filter builder, purpose (free text or predefined), preview action, estimated_recipient_count display (refreshed, not stale), schedule datetime or "enviar ahora."

## 11. State inventory per screen

/eventos: loading skeleton; nine distinct empty/error variants per S56 (never share one generic message, never show an error as empty); success grid whose cards never promise more than the Event Page CTA allows.
/eventos/[slug]: loading skeleton per block; CTA states exactly as the J7 table (8 states); DATE_CONFIRMED_TIME_PENDING browsable variant; sticky mobile CTA.
/inscripcion/[slug]: see J1 states.
/cuenta and /cuenta/solicitudes: loading skeleton; empty "Aun no tienes inscripciones"; success with live countdown; session-expired redirects to /entrar; no permission-denied surface needed for own account (cross-account access returns generic not-found).
/cuenta/pases: own+guest passes only; per-QR loading spinner distinct from page shell; no replace action (staff-only, J3).
/scanner: the 11 outcomes are the state inventory (J4); plus session-setup-incomplete (blocks scanning) and offline/network-error ("sin conexion, reintenta," never accepts an unverified scan as valid).
/admin/asistencia: loading (universe computation); bulk-action-in-progress; otherwise J5 states.
/admin/cierre: "cerrado, notificaciones pendientes" as a legitimate partial-success state; otherwise J5.
/ranking: OPEN (live), CONSOLIDATING (banner "en proceso de cierre, los numeros pueden cambiar"), CLOSED (official, immutable) per period.
Avatar (/cuenta/perfil): empty (no avatar, placeholder+upload CTA); loading (upload/processing); PENDING_REVIEW ("en revision," prior APPROVED stays public per S116); APPROVED; REJECTED (retry immediately, no cooldown); REMOVED-with-suspension (three months, countdown/end-date shown, S116).
Identity-locked/banned: see J11 -- action plainly blocked, explanation without internal detail, support path, never relies on hidden UI alone (S230).

