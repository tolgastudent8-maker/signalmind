"use client";

import { Card, timeAgo, usePoll } from "./ui";
import type { AutopilotSettings } from "@/lib/autopilot";

type Status = {
  settings: AutopilotSettings;
  today: number;
  candidates: { id: string; title: string; sources: number }[];
  last: { started?: string; reason: string; at: number } | null;
};

export function AutopilotCard() {
  const { data, reload } = usePoll<Status>("/api/autopilot", 20000);

  async function save(patch: Partial<AutopilotSettings>) {
    await fetch("/api/autopilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    reload();
  }

  const s = data?.settings;
  return (
    <Card
      title="Otonom mod"
      action={
        <button
          role="switch"
          aria-checked={Boolean(s?.enabled)}
          onClick={() => s && save({ enabled: !s.enabled })}
          className={`relative h-6 w-11 rounded-full transition ${s?.enabled ? "bg-signal" : "bg-ink-600"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink-950 transition-all ${s?.enabled ? "left-[22px]" : "left-0.5"}`} />
          <span className="sr-only">Otonom modu aç/kapat</span>
        </button>
      }
    >
      <p className="text-sm text-ink-300">
        Açıkken ajan, son 90 dakikada <b className="text-ink-100">en az {s?.minSources ?? 2} kaynağın</b> doğruladığı yeni hikâyeleri kendisi analiz eder. Aynı anda tek analiz,
        günlük sınırla.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-ink-300">
          Günlük sınır
          <select
            value={s?.dailyCap ?? 5}
            onChange={(e) => save({ dailyCap: Number(e.target.value) })}
            className="rounded-md bg-ink-900 px-1.5 py-0.5 text-ink-100 outline-none ring-1 ring-ink-600"
          >
            {[3, 5, 10, 20].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-ink-300">
          En az kaynak
          <select
            value={s?.minSources ?? 2}
            onChange={(e) => save({ minSources: Number(e.target.value) })}
            className="rounded-md bg-ink-900 px-1.5 py-0.5 text-ink-100 outline-none ring-1 ring-ink-600"
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="num ml-auto text-ink-400">
          bugün {data?.today ?? 0}/{s?.dailyCap ?? 5}
        </span>
      </div>
      {data?.last && s?.enabled && (
        <div className="mt-3 text-xs text-ink-400">
          Son kontrol {timeAgo(data.last.at)}: <span className={data.last.started ? "text-signal" : "text-ink-300"}>{data.last.reason}</span>
        </div>
      )}
      {data && data.candidates.length > 0 && (
        <div className="mt-3 border-t border-ink-800 pt-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Sıradaki adaylar</div>
          <ul className="space-y-1 text-[13px] text-ink-200">
            {data.candidates.slice(0, 3).map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className="num shrink-0 text-atk">{c.sources}×</span>
                <span className="line-clamp-1">{c.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
