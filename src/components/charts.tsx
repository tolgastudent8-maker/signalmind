"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { Bucket } from "@/lib/scorecard";

const AXIS = { stroke: "#3a4458", fontSize: 11, tickLine: false, axisLine: false } as const;
const TIP = {
  contentStyle: { background: "#10141c", border: "1px solid #2a3243", borderRadius: 10, fontSize: 12 },
  labelStyle: { color: "#b8c0cf" },
  itemStyle: { color: "#e4e8ef" },
};

export function CalibrationChart({ buckets }: { buckets: Bucket[] }) {
  const data = buckets.map((b) => ({
    label: b.label,
    beyan: Math.round(b.avgConfidence * 100),
    gercek: b.hitRate === null ? null : Math.round(b.hitRate * 100),
    n: b.n,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="#1e2532" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis domain={[0, 100]} {...AXIS} unit="%" />
        <Tooltip {...TIP} formatter={(v, name, item) => [`%${v} (n=${item.payload.n})`, name === "beyan" ? "Beyan edilen güven" : "Gerçekleşen isabet"]} />
        <Legend formatter={(v) => (v === "beyan" ? "Beyan edilen güven" : "Gerçekleşen isabet")} wrapperStyle={{ fontSize: 12 }} />
        <Line isAnimationActive={false} type="monotone" dataKey="beyan" stroke="#5b667d" strokeDasharray="5 4" dot={false} strokeWidth={2} />
        <Line isAnimationActive={false} type="monotone" dataKey="gercek" stroke="#c6f432" strokeWidth={2.5} connectNulls dot={{ r: 4, fill: "#c6f432" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BaselineChart({ rows }: { rows: { name: string; value: number | null; highlight?: boolean }[] }) {
  const data = rows.map((r) => ({ ...r, pct: r.value === null ? 0 : Math.round(r.value * 100) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, left: 10, bottom: 0 }}>
        <CartesianGrid stroke="#1e2532" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} {...AXIS} unit="%" />
        <YAxis type="category" dataKey="name" width={120} {...AXIS} tick={{ fill: "#b8c0cf", fontSize: 12 }} />
        <Tooltip {...TIP} cursor={{ fill: "rgba(255,255,255,0.03)" }} formatter={(v) => [`%${v}`, "İsabet"]} />
        <Bar isAnimationActive={false} dataKey="pct" radius={[0, 6, 6, 0]} label={{ position: "right", fill: "#b8c0cf", fontSize: 11, formatter: (v: unknown) => `%${v}` }}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.highlight ? "#c6f432" : "#3a4458"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AccuracyTimeline({ points }: { points: { ts: number; cumulative: number; n: number }[] }) {
  const data = points.map((p) => ({ ts: p.ts, acc: Math.round(p.cumulative * 1000) / 10, n: p.n }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="#1e2532" vertical={false} />
        <XAxis
          dataKey="ts"
          type="number"
          domain={["dataMin", "dataMax"]}
          {...AXIS}
          tickFormatter={(t) => new Date(t).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit" })}
        />
        <YAxis domain={[0, 100]} {...AXIS} unit="%" />
        <Tooltip {...TIP} labelFormatter={(t) => new Date(Number(t)).toLocaleString("tr-TR")} formatter={(v, _n, item) => [`%${v} (n=${item.payload.n})`, "Kümülatif isabet"]} />
        <ReferenceLine y={50} stroke="#3a4458" strokeDasharray="4 4" />
        <Line isAnimationActive={false} type="stepAfter" dataKey="acc" stroke="#c6f432" strokeWidth={2} dot={data.length < 40 ? { r: 2.5, fill: "#c6f432" } : false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
