import { env } from "./env.js";
import { STAGES } from "./db.js";

export const product = {
  name: "ClearPath Business",
  family: "ClearPath",
  company: "Denovo Credit",
  maker: "Innotel Labs",
  domain: "denovocredit.com",
  support: env.supportEmail,
  phone: env.supportPhone,
  site: env.denovoSite,
};

export { STAGES };

export const money = (value) =>
  "$" +
  Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

export const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

export function fmtDate(value, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDay(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const stageName = (stage) => STAGES[Number(stage)]?.name || "Unknown";

export const stageTier = (stage) => STAGES[Number(stage)]?.tier || "Stage";

export function stageClass(stage) {
  return ["gray", "violet", "blue", "teal"][Number(stage)] || "gray";
}

export function statusClass(status) {
  return (
    {
      New: "amber",
      Contacted: "blue",
      Qualified: "violet",
      Proposal: "amber",
      Won: "teal",
      Lost: "gray",
      Open: "amber",
      Done: "teal",
      Active: "blue",
      Paused: "gray",
      Received: "teal",
      Requested: "amber",
    }[status] || "gray"
  );
}

/** Only allow local redirect targets. */
export function safeNext(value, fallback = "/app") {
  const next = String(value || "");
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

export function percent(value, max) {
  if (!max) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(value) / Number(max)) * 100)));
}
