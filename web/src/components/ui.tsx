import { useEffect, type ReactNode } from "react";
import { Coin, Heart } from "../art/icons";
import { fmtUtang } from "../near/format";
import { levelProgress } from "../near/rules";
import { useGame } from "../game/GameProvider";

export function Button({
  children,
  onClick,
  kind = "primary",
  disabled,
  title,
  small,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "danger" | "ghost" | "good";
  disabled?: boolean;
  title?: string;
  small?: boolean;
  type?: "button" | "submit";
}) {
  const { busy } = useGame();
  return (
    <button
      type={type}
      className={`btn btn-${kind}${small ? " btn-small" : ""}`}
      onClick={onClick}
      disabled={disabled || !!busy}
      title={title}
    >
      {children}
    </button>
  );
}

export function Panel({ title, children, className, right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`panel ${className ?? ""}`}>
      {title ? (
        <header className="panel-head">
          <h2>{title}</h2>
          {right}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Amount({ value, big }: { value: string | bigint; big?: boolean }) {
  return (
    <span className={`amount${big ? " amount-big" : ""}`}>
      <Coin size={big ? 22 : 14} />
      {fmtUtang(value)}
    </span>
  );
}

export function TrustMeter({ trust, step }: { trust: number; step: number }) {
  const { frac, next } = levelProgress(trust, step);
  const filled = Math.round(frac * 5);
  return (
    <div className="trust-meter" title={`${trust} trust · next level at ${next}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Heart key={i} empty={i >= filled} size={16} />
      ))}
      <span className="muted small">
        {trust} / {next}
      </span>
    </div>
  );
}

export function LimitBar({ used, limit }: { used: string; limit: string }) {
  const l = Number(limit) || 1;
  const pct = Math.min(100, (Number(used) / l) * 100);
  return (
    <div className="limitbar" title={`${fmtUtang(used)} of ${fmtUtang(limit)} lent out`}>
      <div className="limitbar-fill" style={{ width: `${pct}%` }} />
      <span>
        {fmtUtang(used)} / {fmtUtang(limit)}
      </span>
    </div>
  );
}

/** One message at a time, in the top bar's place, so it never covers the HUD or dialogs. */
export function Toasts() {
  const { toasts, dismissToast } = useGame();
  const t = toasts[0];
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => dismissToast(t.id), t.kind === "err" ? 4500 : 3000);
    return () => clearTimeout(timer);
  }, [t, dismissToast]);
  return (
    <div className="toasts" aria-live="polite">
      {t ? (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)} role="status">
          {t.kind === "coin" ? <Coin size={18} spin /> : null}
          <div className="toast-text">
            <strong>{t.title}</strong>
            {t.body ? <span>{t.body}</span> : null}
          </div>
          {toasts.length > 1 ? <span className="toast-more">+{toasts.length - 1}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          className={`tab${o.id === value ? " tab-on" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
