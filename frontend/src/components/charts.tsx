import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table2, BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "./ui/primitives";
import { EmptyState } from "./common";

/** Single-series chart hue (validated: lightness, chroma and ≥3:1 contrast on white). */
export const SERIES = "#16A34A";
const AXIS = "#64748B";
const GRID = "#E2E8F0";

interface Datum {
  label: string;
  value: number;
}

function ChartTooltip({ active, payload, unit }: { active?: boolean; payload?: { payload: Datum }[]; unit?: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-lift">
      <p className="font-medium text-ink">{d.label}</p>
      <p className="text-muted-foreground">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: SERIES }} />
        {d.value.toLocaleString("en-IN")} {unit}
      </p>
    </div>
  );
}

/**
 * One measure, one hue, no legend (the title names the series). Horizontal layout for
 * categorical identity (long labels); vertical for time.
 */
export function SimpleBarChart({
  title,
  description,
  data,
  unit,
  horizontal,
  height = 240,
}: {
  title: string;
  description?: string;
  data: Datum[];
  unit?: string;
  horizontal?: boolean;
  height?: number;
}) {
  const [asTable, setAsTable] = useState(false);
  const empty = data.length === 0 || data.every((d) => d.value === 0);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {!empty && (
          <button
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-ink"
            onClick={() => setAsTable((t) => !t)}
            aria-label={asTable ? "Show chart" : "Show data table"}
            title={asTable ? "Show chart" : "Show data table"}
          >
            {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          </button>
        )}
      </CardHeader>
      <CardContent>
        {empty ? (
          <EmptyState title="No data yet" description="This chart fills in as batches are recorded on-chain." className="py-8" />
        ) : asTable ? (
          <Table>
            <THead>
              <TR>
                <TH>{horizontal ? "Category" : "Period"}</TH>
                <TH className="text-right">Value{unit ? ` (${unit})` : ""}</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((d) => (
                <TR key={d.label}>
                  <TD>{d.label}</TD>
                  <TD className="text-right tabular-nums">{d.value.toLocaleString("en-IN")}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <div style={{ height: horizontal ? Math.max(120, data.length * 36 + 24) : height }}>
            <ResponsiveContainer width="100%" height="100%">
              {horizontal ? (
                <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }} barCategoryGap={8}>
                  <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="0" />
                  <XAxis type="number" tick={{ fill: AXIS, fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" width={130} tick={{ fill: AXIS, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "#F1F5F9" }} content={<ChartTooltip unit={unit} />} />
                  <Bar dataKey="value" fill={SERIES} radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              ) : (
                <BarChart data={data} margin={{ left: -12, right: 8, top: 8, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: AXIS, fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "#F1F5F9" }} content={<ChartTooltip unit={unit} />} />
                  <Bar dataKey="value" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
