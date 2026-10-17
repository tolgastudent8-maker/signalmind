"use client";

/**
 * Data-flow diagram of the pipeline. Nodes are laid out on a fixed grid in an
 * SVG viewBox so it scales with its card; colours come from the theme tokens.
 */

type Node = { id: string; x: number; y: number; w: number; label: string; sub: string; color: string; live?: boolean };

const NODES: Node[] = [
  { id: "rss", x: 20, y: 40, w: 150, label: "RSS · 4 kaynak", sub: "her 5 dk", color: "var(--color-ink-300)" },
  { id: "story", x: 20, y: 140, w: 150, label: "Hikâye gruplama", sub: "anahtar kelime örtüşmesi", color: "var(--color-ink-300)" },
  { id: "news", x: 230, y: 40, w: 150, label: "News Analyst", sub: "tür · güvenilirlik", color: "var(--color-ink-100)" },
  { id: "impact", x: 230, y: 140, w: 150, label: "Impact Radar", sub: "130+ token evreni", color: "var(--color-signal)" },
  { id: "bull", x: 440, y: 20, w: 120, label: "Bull", sub: "paralel", color: "var(--color-bull)" },
  { id: "bear", x: 440, y: 100, w: 120, label: "Bear", sub: "paralel", color: "var(--color-bear)" },
  { id: "judge", x: 440, y: 190, w: 120, label: "Hakem", sub: "kanıt puanı", color: "var(--color-judge)" },
  { id: "strategy", x: 620, y: 100, w: 160, label: "Strategy & Risk", sub: "araç döngüsü", color: "var(--color-atk)" },
  { id: "atk", x: 840, y: 40, w: 140, label: "ATK MCP", sub: "okx-trade-mcp · TR", color: "var(--color-atk)", live: true },
  { id: "okx", x: 840, y: 140, w: 140, label: "OKX TR", sub: "ticker · mum · RSI", color: "var(--color-ink-300)", live: true },
  { id: "rules", x: 620, y: 230, w: 160, label: "Kural motoru", sub: "taban oran · tutarlılık", color: "var(--color-judge)" },
  { id: "karne", x: 840, y: 250, w: 140, label: "Tahmin karnesi", sub: "SQLite · her dk puan", color: "var(--color-signal)" },
];

const EDGES: [string, string, string?][] = [
  ["rss", "story"],
  ["story", "news"],
  ["news", "impact"],
  ["impact", "bull"],
  ["impact", "bear"],
  ["bull", "judge"],
  ["bear", "judge"],
  ["judge", "strategy"],
  ["strategy", "atk", "araç çağrısı"],
  ["atk", "okx"],
  ["strategy", "rules"],
  ["rules", "karne"],
  ["okx", "karne", "çıkış fiyatı"],
  ["karne", "strategy", "hafıza"],
];

const H = 52;
const byId = new Map(NODES.map((n) => [n.id, n]));

function anchor(a: Node, b: Node): [number, number, number, number] {
  const ax = a.x + a.w / 2;
  const ay = a.y + H / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + H / 2;
  const horizontal = Math.abs(bx - ax) > Math.abs(by - ay) * 1.2;
  if (horizontal) {
    const sx = bx > ax ? a.x + a.w : a.x;
    const ex = bx > ax ? b.x : b.x + b.w;
    return [sx, ay, ex, by];
  }
  const sy = by > ay ? a.y + H : a.y;
  const ey = by > ay ? b.y : b.y + H;
  return [ax, sy, bx, ey];
}

export function Architecture({ active }: { active?: Record<string, boolean> }) {
  return (
    <svg viewBox="0 0 1000 320" className="w-full" role="img" aria-label="SignalMind veri akışı şeması">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--color-ink-500)" />
        </marker>
      </defs>
      {EDGES.map(([from, to, label]) => {
        const [x1, y1, x2, y2] = anchor(byId.get(from)!, byId.get(to)!);
        const mx = (x1 + x2) / 2;
        const path = Math.abs(x2 - x1) > Math.abs(y2 - y1) ? `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`;
        const back = from === "karne" && to === "strategy";
        return (
          <g key={`${from}-${to}`}>
            {/* The memory loop runs up the gutter between the Strategy and ATK columns so it never crosses a node. */}
            <path
              d={back ? `M${byId.get("karne")!.x},${byId.get("karne")!.y + 14} C 806 ${byId.get("karne")!.y + 14}, 806 ${byId.get("strategy")!.y + 40}, ${byId.get("strategy")!.x + byId.get("strategy")!.w},${byId.get("strategy")!.y + 40}` : path}
              fill="none"
              stroke={back ? "var(--color-judge)" : "var(--color-ink-600)"}
              strokeWidth="1.5"
              strokeDasharray={back ? "4 4" : undefined}
              markerEnd="url(#arrow)"
            />
            {label && (
              <text x={back ? 822 : mx} y={back ? 205 : (y1 + y2) / 2 - 6} textAnchor={back ? "start" : "middle"} fontSize="10" fill={back ? "var(--color-judge)" : "var(--color-ink-400)"}>
                {label}
              </text>
            )}
          </g>
        );
      })}
      {NODES.map((n) => (
        <g key={n.id}>
          <rect x={n.x} y={n.y} width={n.w} height={H} rx="10" fill="var(--color-ink-900)" stroke={active?.[n.id] === false ? "var(--color-down)" : n.color} strokeOpacity={0.55} />
          <circle cx={n.x + 14} cy={n.y + 18} r="3.5" fill={n.color} />
          {n.live && <circle cx={n.x + 14} cy={n.y + 18} r="7" fill="none" stroke={n.color} strokeOpacity="0.4" />}
          <text x={n.x + 26} y={n.y + 22} fontSize="13" fontWeight="600" fill="var(--color-ink-100)">
            {n.label}
          </text>
          <text x={n.x + 14} y={n.y + 40} fontSize="10.5" fill="var(--color-ink-400)">
            {n.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}
