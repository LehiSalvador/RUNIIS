import type { Metadata } from "next";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { FriendsManager, type FriendsTab } from "@/components/account/friends-manager";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { listMyFriendships } from "@/lib/server/domain/people/service";

export const metadata: Metadata = { title: "Amigos" };

const TITLE = "Amigos";
const TABS: readonly FriendsTab[] = ["amigos", "recibidas", "enviadas", "buscar"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function FriendsPage({ searchParams }: { searchParams: SearchParams }) {
  const account = await requireReadyAccount("/cuenta/amigos");
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  const params = await searchParams;
  const requested = typeof params.tab === "string" ? params.tab : "";
  const { supabase } = account;

  const [friends, incoming, outgoing] = await Promise.all([
    settle(listMyFriendships(supabase, "FRIENDS", undefined)),
    settle(listMyFriendships(supabase, "INCOMING", undefined)),
    settle(listMyFriendships(supabase, "OUTGOING", undefined)),
  ]);
  const failed = [friends, incoming, outgoing].find((result) => !result.ok);
  if (failed && !failed.ok) {
    return (
      <AccountShell pageTitle={TITLE}>
        <SectionError code={failed.code} title="No pudimos cargar tus amistades." />
      </AccountShell>
    );
  }
  const data = {
    friends: friends.ok ? friends.data : { items: [], nextCursor: null },
    incoming: incoming.ok ? incoming.data : { items: [], nextCursor: null },
    outgoing: outgoing.ok ? outgoing.data : { items: [], nextCursor: null },
  };
  const initialTab: FriendsTab = (TABS as readonly string[]).includes(requested)
    ? (requested as FriendsTab)
    : data.incoming.items.length > 0
      ? "recibidas"
      : "amigos";

  return (
    <AccountShell pageTitle={TITLE}>
      <FriendsManager initial={data} initialTab={initialTab} />
    </AccountShell>
  );
}
