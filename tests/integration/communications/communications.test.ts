import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEditionReminder, getMyCommunicationPreferences, updateMyCommunicationPreferences } from "@/lib/server/domain/communications/service";
import { cancelCommunicationCampaign, createCommunicationCampaign, previewCommunicationCampaign, sendCommunicationCampaign } from "@/lib/server/domain/communications/admin-service";
import { runOutboxDispatch } from "@/lib/server/workers/outbox/dispatcher";
import { runCommunicationDispatch } from "@/lib/server/domain/communications/dispatch";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { buildEdition, ensureGlobalLegalDocumentsPublished, selfAcceptance } from "../registration/helpers";
import { APP_URL, cleanup, createTestStaff, createTestUser, queryValue, sql, systemClient, type TestStaff, type TestUser } from "../helpers";

// T35 communications end to end against the real local Postgres + RLS + capture/Mailpit adapter
// (EMAIL_DELIVERY_MODE=capture in .env.development.local — no real Brevo sandbox key is injected in
// this environment, see the T35 handoff blockers). Master §125-141, §147-148, §206.

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54624";

type MailpitMessage = {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Attachments: { FileName: string; ContentType: string; Size: number }[];
};

async function findMailpitMessage(predicate: (m: MailpitMessage) => boolean, timeoutMs = 15_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await fetch(new URL("/api/v1/messages?limit=50", MAILPIT_URL));
    const body = (await response.json()) as { messages: MailpitMessage[] };
    const found = body.messages.find(predicate);
    if (found) {
      const detail = await fetch(new URL(`/api/v1/message/${found.ID}`, MAILPIT_URL));
      return (await detail.json()) as MailpitMessage;
    }
    if (Date.now() > deadline) throw new Error("expected Mailpit message not found within timeout");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Drains the outbox + message dispatcher a few times (shared local DB: other agents may also enqueue). */
async function drainDispatch(system: SupabaseClient, rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await runOutboxDispatch(system, { limit: 100 });
    await runCommunicationDispatch(system, { limit: 100 });
  }
}

async function messageStatus(dedupeKey: string): Promise<string | null> {
  return queryValue(`select status from app.communication_message where dedupe_key = '${dedupeKey}'`);
}

describe("communications (T35) integration", () => {
  let admin: TestStaff;
  const authUserIds: string[] = [];

  beforeAll(async () => {
    ensureGlobalLegalDocumentsPublished();
    admin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId);
  }, 30_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  test(
    "RegistrationConfirmed outbox -> a REGISTRATION_CONFIRMED message -> capture adapter (Mailpit) with the participant's own pass QR attached",
    async () => {
      const edition = await buildEdition(admin.client, { mode: "FREE" });
      const runner = await createTestUser({ label: "comms-int-self" });
      authUserIds.push(runner.authUserId);

      const view = await createRegistrationRequest(
        runner.client,
        {
          edition_id: edition.editionId,
          participants: [{ kind: "PROFILE", public_profile_id: runner.publicProfileId!, modality_id: edition.modalityId }],
          legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
        },
        null,
      );
      expect(view.status).toBe("CONFIRMED");
      const registrationId = view.participants[0]?.registration?.registration_id;
      expect(registrationId).toBeTruthy();
      const dedupeKey = `REGISTRATION_CONFIRMED:${registrationId}`;

      const system = systemClient();
      await drainDispatch(system);
      const status = await messageStatus(dedupeKey);
      expect(status).toBe("SENT");

      const mail = await findMailpitMessage((m) => m.To[0]?.Address === runner.email.toLowerCase() && m.Subject.includes("Inscripción confirmada"));
      const qr = mail.Attachments.find((a) => a.FileName === "pase-qr.png");
      expect(qr, "the participant's own confirmation email carries their pass QR as an attachment").toBeTruthy();
      expect(qr!.ContentType).toBe("image/png");
      expect(qr!.Size).toBeGreaterThan(0);
    },
    45_000,
  );

  test(
    "campaign recipient revalidation (Master §206): consent withdrawn after the candidate snapshot blocks the send, never delivering it",
    async () => {
      const edition = await buildEdition(admin.client, { mode: "FREE" });
      const runner = await createTestUser({ label: "comms-int-consent" });
      authUserIds.push(runner.authUserId);

      await updateMyCommunicationPreferences(runner.client, { general_marketing: true });
      expect((await getMyCommunicationPreferences(runner.client)).purposes.GENERAL_MARKETING.granted).toBe(true);

      const campaign = await createCommunicationCampaign(
        admin.client,
        { campaign_type: "MARKETING", template_key: "NEW_EDITION", edition_id: edition.editionId, audience: { segment: "MARKETING_OPT_IN" }, template_variables: {} },
        null,
      );
      await previewCommunicationCampaign(admin.client, campaign.campaign_id);
      const sent = await sendCommunicationCampaign(admin.client, campaign.campaign_id, null);
      expect(sent.snapshot?.candidates).toBeGreaterThanOrEqual(1);

      // Withdraw AFTER the campaign already snapshotted and enqueued the message.
      await updateMyCommunicationPreferences(runner.client, { general_marketing: false });

      const system = systemClient();
      await drainDispatch(system);

      const dedupeKey = `CAMPAIGN:${campaign.campaign_id}:%`;
      const status = queryValue(`select status from app.communication_message
        where campaign_id = '${campaign.campaign_id}' and dedupe_key like '${dedupeKey}'
          and recipient_id = (select r.communication_recipient_id from app.communication_recipient r
                               join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
                               where rp.auth_user_id = '${runner.authUserId}')`);
      expect(status).toBe("CANCELED");
      const lastError = queryValue(`select last_error from app.communication_message
        where campaign_id = '${campaign.campaign_id}' and dedupe_key like '${dedupeKey}'
          and recipient_id = (select r.communication_recipient_id from app.communication_recipient r
                               join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
                               where rp.auth_user_id = '${runner.authUserId}')`);
      expect(lastError).toBe("CONSENT_WITHDRAWN");
    },
    30_000,
  );

  test("admin can cancel a campaign before it ever sends", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const campaign = await createCommunicationCampaign(
      admin.client,
      { campaign_type: "MARKETING", template_key: "NEW_EDITION", edition_id: edition.editionId, audience: { segment: "MARKETING_OPT_IN" }, template_variables: {} },
      null,
    );
    await previewCommunicationCampaign(admin.client, campaign.campaign_id);
    const canceled = await cancelCommunicationCampaign(admin.client, campaign.campaign_id, "integration test");
    expect(canceled.status).toBe("CANCELED");
  }, 20_000);

  test(
    "webhook duplicate detection (F2/SEC-080): unauthenticated deliveries are evidence-only and never dedupe-claim the authenticated key space",
    async () => {
      const payload = JSON.stringify({ event: "delivered", "message-id": `<int-test-${Date.now()}@brevo>`, ts: Math.floor(Date.now() / 1000) });
      const post = () => fetch(new URL("/api/webhooks/brevo", APP_URL), { method: "POST", headers: { "content-type": "application/json" }, body: payload });

      const first = await post();
      expect(first.status).toBe(401); // no BREVO_WEBHOOK_AUTH_SECRET configured in this environment: never authenticated
      const second = await post();
      expect(second.status).toBe(401);

      const providerEventId = queryValue(`select provider_event_id from infra.communication_provider_event
        where payload_safe ->> 'message_id' = '<int-test-${payload.match(/int-test-(\d+)/)![1]}@brevo>' limit 1`);
      expect(providerEventId).toBeTruthy();
      // F2: an unauthenticated delivery is never deduped against another unauthenticated delivery of
      // the same event -- it holds no claim on the (provider, provider_event_id) key space at all, so
      // an identical repeat is recorded again as its own evidence row rather than silently occupying
      // the slot an authentic delivery would need.
      const count = queryValue(`select count(*)::text from infra.communication_provider_event where provider_event_id = '${providerEventId}'`);
      expect(count).toBe("2");
      const statuses = queryValue(`select string_agg(distinct processing_status, ',') from infra.communication_provider_event where provider_event_id = '${providerEventId}'`);
      expect(statuses).toBe("UNAUTHENTICATED");
    },
    15_000,
  );

  test("reminders: a logged-in user's reminder is ACTIVE immediately and communication-reconcile runs without error", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    sql(`update app.edition set registration_state = 'NOT_OPEN', registration_open_at = now() + interval '10 days' where edition_id = '${edition.editionId}'`);
    const runner = await createTestUser({ label: "comms-int-reminder" });
    authUserIds.push(runner.authUserId);

    const reminder = await createEditionReminder(runner.client, edition.editionId);
    expect(reminder.status).toBe("ACTIVE");

    const { runCommunicationReconcile } = await import("@/lib/server/domain/communications/reconcile");
    const summary = await runCommunicationReconcile(systemClient());
    expect(typeof summary.campaigns_started).toBe("number");
  }, 20_000);
});
