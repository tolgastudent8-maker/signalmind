"use client";

import { Card, Empty, timeAgo, usePoll } from "@/components/ui";
import type { Telemetry } from "@/lib/telemetry";

type Probe = { ms: number | null; ok: boolean; error?: string };
type System = {
  now: number;
  ai: { provider: string; label: string; model: string; configured: boolean };
  gemini: { model: string; exhaustedUntil: number | null }[] | null;
  atk: { connected: boolean; lastError?: string; tools: { name: string; description?: string }[]; probe: Probe; args: string };
  rest: { probe: Probe };
  scheduler: { lastEval?: number; lastFeed?: number; lastError?: string; lastAutopilot?: { reason: string; at: number } };
  autopilot: { enabled: boolean; dailyCap: number; minSources: number; today: number };
  runtime: { node: string; uptimeSec: number; rssMb: number };
  config: {
    flatBand: Record<string, number>;
    maxTokensPerAnalysis: number;
    maxConcurrent: number;
    agentTools: string[];
    evalIntervalSec: number;
    rssIntervalMin: number;
    storyWindowH: number;
    autopilotFreshMin: number;
  };
  telemetry: Telemetry;
};

const sec = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} sn`);

function Health({ label, ok, value, hint }: { label: string; ok: boolean | null; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        <span className={`h-2 w-2 rounded-full ${ok === null ? "bg-ink-500" : ok ? "bg-up pulse-ring" : "bg-down"}`} />
        {label}
      </div>
      <div className="num mt-1.5 text-xl text-ink-100">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-ink-400">{hint}</div>}
    </div>
  );
}

function Bar({ value, max, color = "var(--color-atk)" }: { value: number; max: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
      <div className="h-full rounded-full" style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} />
    </div>
  );
}

export default function Sistem() {
  const { data: s, error } = usePoll<System>("/api/system", 15000);
  if (error) return <Empty>{error}</Empty>;
  if (!s) return <div className="shimmer h-96 rounded-2xl bg-ink-850" />;
  const t = s.telemetry;
  const maxTool = Math.max(1, ...t.tools.map((x) => x.calls));
  const used = new Set(t.tools.map((x) => x.name));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Sistem durumu</h1>
          <p className="mt-1 text-sm text-ink-300">OKX ATK, yapay zekâ ve haber arşivi bağlantılarının canlı ölçümleri. 15 sn&apos;de bir yenilenir.</p>
        </div>
        <div className="num flex gap-3 text-[11px] text-ink-400">
          <span>node {s.runtime.node}</span>
          <span>çalışma {Math.floor(s.runtime.uptimeSec / 60)} dk</span>
          <span>bellek {s.runtime.rssMb} MB</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Health label="ATK MCP" ok={s.atk.probe.ok} value={s.atk.probe.ok ? sec(s.atk.probe.ms) : "hata"} hint={s.atk.probe.error ?? `${s.atk.tools.length} araç · BTC-USDT ticker`} />
        <Health label="OKX TR REST" ok={s.rest.probe.ok} value={s.rest.probe.ok ? sec(s.rest.probe.ms) : "hata"} hint={s.rest.probe.error ?? "yedek veri yolu"} />
        <Health label={s.ai.label} ok={s.ai.configured} value={s.ai.configured ? "hazır" : "anahtar yok"} hint={s.ai.model} />
        <Health label="RSS arşivi" ok={s.scheduler.lastFeed ? Date.now() - s.scheduler.lastFeed < 15 * 60_000 : null} value={s.scheduler.lastFeed ? timeAgo(s.scheduler.lastFeed) : "—"} hint={`${s.config.rssIntervalMin} dk'da bir yenilenir`} />
      </div>

      <p className="text-xs text-ink-400">
        ATK sunucuları <code className="num rounded bg-ink-900 px-1 text-ink-200">okx-trade-mcp --site tr --modules market|news --read-only</code> ile başlatılır; Guard emir gönderemez.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="ATK araç çağrıları">
          {t.tools.length === 0 ? (
            <Empty>Henüz ATK çağrısı yok.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="text-[11px] uppercase tracking-wider text-ink-400">
                <tr>
                  <th className="pb-2 text-left font-medium">Araç</th>
                  <th className="pb-2 text-right font-medium">çağrı</th>
                  <th className="pb-2 text-right font-medium">hata</th>
                  <th className="pb-2 text-right font-medium">ort.</th>
                  <th className="w-1/4 pb-2 pl-4 font-medium" />
                </tr>
              </thead>
              <tbody className="num">
                {t.tools.map((x) => (
                  <tr key={x.name} className="border-t border-ink-800">
                    <td className="py-2 text-atk">{x.name}</td>
                    <td className="py-2 text-right text-ink-200">{x.calls}</td>
                    <td className={`py-2 text-right ${x.errors ? "text-down" : "text-ink-500"}`}>{x.errors}</td>
                    <td className="py-2 text-right text-ink-300">{sec(x.avgMs)}</td>
                    <td className="py-2 pl-4">
                      <Bar value={x.calls} max={maxTool} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              ATK sunucusundaki araçlar ({s.atk.tools.length}) · ajana açık olanlar vurgulu
            </div>
            <div className="flex flex-wrap gap-1">
              {s.atk.tools.map((x) => (
                <span
                  key={x.name}
                  title={x.description}
                  className={`num rounded px-1.5 py-0.5 text-[10.5px] ring-1 ring-inset ${
                    s.config.agentTools.includes(x.name) ? "bg-atk/10 text-atk ring-atk/30" : "text-ink-500 ring-ink-700"
                  } ${used.has(x.name) ? "font-semibold" : ""}`}
                >
                  {x.name}
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Haber verisi">
          <dl className="num grid grid-cols-2 gap-y-2 text-[13px]">
            <dt className="text-ink-400">Haber</dt>
            <dd className="text-right text-ink-100">{t.news.items}</dd>
            <dt className="text-ink-400">Hikâye</dt>
            <dd className="text-right text-ink-100">{t.news.stories}</dd>
            <dt className="text-ink-400">Çok kaynaklı</dt>
            <dd className="text-right text-atk">{t.news.multiSource}</dd>
          </dl>
          <div className="mt-3 space-y-1.5 border-t border-ink-800 pt-3">
            {t.news.bySource.map((x) => (
              <div key={x.source} className="grid grid-cols-[90px_1fr_32px] items-center gap-2 text-[12px]">
                <span className="truncate text-ink-300">{x.source}</span>
                <Bar value={x.n} max={Math.max(...t.news.bySource.map((y) => y.n))} color="var(--color-ink-400)" />
                <span className="num text-right text-ink-400">{x.n}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
