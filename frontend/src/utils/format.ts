export const shortAddress = (a?: string | null, chars = 4) =>
  a ? `${a.slice(0, 2 + chars)}…${a.slice(-chars)}` : "—";

export const shortHash = (h?: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");

export const formatBatchId = (id: number | bigint | string) => `FC-${id}`;

/** Accepts "10001", "FC-10001", "fc-10001" or a full trace URL. */
export function parseBatchId(input: string): number | null {
  const trimmed = input.trim();
  const fromUrl = /\/trace\/(?:fc-)?(\d{1,12})\/?(?:[?#].*)?$/i.exec(trimmed);
  if (fromUrl) return Number(fromUrl[1]);
  const m = /^(?:fc-)?(\d{1,12})$/i.exec(trimmed);
  return m ? Number(m[1]) : null;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const formatDate = (d?: Date | string | number | null) => (d ? dateFmt.format(new Date(d)) : "—");
export const formatDateTime = (d?: Date | string | number | null) => (d ? dateTimeFmt.format(new Date(d)) : "—");

export const formatNumber = (n: number | bigint) => new Intl.NumberFormat("en-IN").format(n);

export function timeAgo(d: Date | string | number) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [2592000, "month"],
  ];
  let label = `${Math.floor(s / 60)} minutes`;
  for (const [sec, name] of units) {
    const v = Math.floor(s / sec);
    if (v >= 1) label = `${v} ${name}${v > 1 ? "s" : ""}`;
  }
  return `${label} ago`;
}

/** Converts a yyyy-mm-dd date input into unix seconds at local noon. */
export function dateInputToUnix(value: string): number {
  return Math.floor(new Date(`${value}T12:00:00`).getTime() / 1000);
}

export const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
