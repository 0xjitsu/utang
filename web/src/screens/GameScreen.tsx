// My Store: the game stage. The street (or simple SVG store) fills it; the HUD sits on top.
import { useEffect, useMemo, useState } from "react";
import { bus } from "../game/bus";
import type { Profile } from "../near/types";
import { StoreScene } from "../art/StoreScene";
import { Coin } from "../art/icons";
import { Hud } from "../components/Hud";
import { Button } from "../components/ui";
import { useGame } from "../game/GameProvider";
import { fmtNear, fmtUtang, shortName } from "../near/format";
import { StoreHero } from "../street/StoreHero";
import { useQuest } from "../components/Quest";

export function GameScreen({
  onPreviewSignIn,
  visiting,
  onGoHome,
}: {
  onPreviewSignIn: () => void;
  visiting: string | null;
  onGoHome: () => void;
}) {
  const { accountId, me, myLoans, rules, now, coinPops, loaded, players, actions } = useGame();
  const homeB = me?.barangay ?? null;
  const streetB = visiting ?? homeB;
  const [fetched, setFetched] = useState<Profile[]>([]);
  useEffect(() => {
    let live = true;
    setFetched([]);
    if (streetB) void actions.playersIn(streetB).then((list) => live && setFetched(list));
    return () => {
      live = false;
    };
  }, [streetB, actions]);
  // Houses on this street: players_in(barangay), kept fresh with the latest profiles.
  const streetPlayers = useMemo(() => {
    if (!streetB) return players;
    const byId = new Map(fetched.map((p) => [p.account_id, p] as const));
    for (const p of players) if (p.barangay === streetB) byId.set(p.account_id, p);
    for (const [id] of byId) {
      const fresh = players.find((p) => p.account_id === id);
      if (fresh && fresh.barangay !== streetB) byId.delete(id);
    }
    return [...byId.values()].sort((a, b) => a.player_index - b.player_index);
  }, [streetB, players, fetched]);
  const neighbourCount = streetPlayers.filter((p) => p.account_id !== accountId).length;

  // Simple view keeps a calm daytime sky (no day/night swing).
  const dayFrac = 0.45;
  void now;
  const quest = useQuest();

  const visitors = myLoans
    .filter((l) => l.lender === accountId && l.status === "Requested")
    .slice(0, 3)
    .map((l) => ({ name: l.borrower, label: `${fmtUtang(l.amount).replace(".00", "")}?` }));

  const svg = (
    <div className="scene-wrap">
      <StoreScene
        owner={accountId}
        visitors={visitors}
        balanceCentavos={me?.balance ?? "0"}
        bayadMuna={!!me?.has_overdue}
        closed={!me}
        dayFrac={dayFrac}
        coinPops={coinPops}
        fit="meet"
      />
      {/* portrait phones: a foreground below the road, so the store sits mid-screen */}
      <div className="scene-ground" aria-hidden />
    </div>
  );

  return (
    <div className="stage">
      <StoreHero simple={svg} street={{ players: streetPlayers, barangay: streetB, isHome: !visiting }} />
      <Hud />
      {visiting ? (
        <div className="visit-banner">
          <span className="visit-text">
            <b>{visiting}</b>
            <small>
              {neighbourCount} neighbour{neighbourCount === 1 ? "" : "s"} here
            </small>
          </span>
          <button className="btn btn-small" onClick={onGoHome}>
            Back home
          </button>
        </div>
      ) : null}
      {me && !me.barangay && rules?.barangays?.length ? (
        <button className="btn btn-small barangay-prompt" onClick={() => bus.emit("open:picker", {})}>
          Where's your tindahan? Choose your barangay
        </button>
      ) : null}
      {loaded && accountId && me && streetB && neighbourCount === 0 ? (
        <div className="empty-street">
          <p>No neighbours here yet — invite someone!</p>
          {quest.view.targetAway && quest.view.target && quest.view.targetBarangay && (quest.view.stage === "ask" || quest.view.stage === "repay") ? (
            <>
              <p className="empty-next">
                Your quest: <b>{shortName(quest.view.target)}</b> is in {quest.view.targetBarangay}.
              </p>
              <button className="btn btn-small" onClick={() => bus.emit("travel", { barangay: quest.view.targetBarangay })}>
                Ride the jeepney to {quest.view.targetBarangay}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {!accountId ? <WelcomeCard onPreviewSignIn={onPreviewSignIn} /> : loaded && !me ? <JoinCard /> : null}
    </div>
  );
}

function WelcomeCard({ onPreviewSignIn }: { onPreviewSignIn: () => void }) {
  const g = useGame();
  return (
    <div className="stage-card">
      <Coin size={36} spin />
      <h2>Welcome to the barangay</h2>
      <p>
        Run a little sari-sari store. Neighbours borrow, you decide whom to trust, and every loan goes in the shared listahan.
      </p>
      {g.mode === "preview" ? (
        <Button onClick={onPreviewSignIn}>Play the preview</Button>
      ) : (
        <Button onClick={() => g.actions.signIn()}>Connect NEAR wallet</Button>
      )}
    </div>
  );
}

function JoinCard() {
  const g = useGame();
  const deposit = g.rules ? fmtNear(g.rules.join_deposit) : "0.01";
  return (
    <div className="stage-card">
      <h2>Open your store</h2>
      <p>
        Join with a {deposit} NEAR storage deposit. You start with trust 0 and can lend up to{" "}
        {g.rules ? fmtUtang(g.rules.starting_limit) : "10.00"}.
      </p>
      <Button onClick={() => g.actions.join()}>Join for {deposit} NEAR</Button>
    </div>
  );
}
