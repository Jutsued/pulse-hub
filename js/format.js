// ------------------------------------------------------------------
// Small helper functions used all over the app.
// Keeping them here makes app.js easier to read.
// ------------------------------------------------------------------

export const COLORS = {
  ink: "#17202e",
  inkSoft: "#4a5568",
  rule: "#d3dae4",
  fear: "#b42318",
  greed: "#0f7b5f",
  neutral: "#9a6b12",
  accent: "#2e4a9e",
};

// A palette for charts with several lines (colorblind-friendly order).
export const SERIES_COLORS = ["#2e4a9e", "#b42318", "#0f7b5f", "#9a6b12", "#7b3fa0", "#0e7490", "#be185d", "#4d7c0f"];

// 1234.5 -> "1,234.50"
export function money(value, digits = 2) {
  if (value === null || value === undefined) return "–";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// 2.345 -> "+2.35%"
export function percent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

// Returns "up", "down" or "flat" — used as a CSS class for coloring.
export function direction(value, threshold = 0) {
  if (value === null || value === undefined) return "flat";
  if (value > threshold) return "up";
  if (value < -threshold) return "down";
  return "flat";
}

// Color for a 0–100 mood score (fear = red, greed = green).
export function moodColor(score) {
  if (score === null || score === undefined) return COLORS.inkSoft;
  if (score < 45) return COLORS.fear;
  if (score > 55) return COLORS.greed;
  return COLORS.neutral;
}

// Color for a -1..+1 sentiment score.
export function toneColor(score) {
  if (score > 0.05) return COLORS.greed;
  if (score < -0.05) return COLORS.fear;
  return COLORS.rule;
}

export function toneWord(score) {
  if (score === null || score === undefined) return "unknown";
  if (score > 0.08) return "upbeat";
  if (score > 0.02) return "slightly upbeat";
  if (score < -0.08) return "gloomy";
  if (score < -0.02) return "slightly gloomy";
  return "neutral";
}

// "2026-11-10T21:05:00Z" -> "Nov 10, 4:05 PM"
export function shortDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// "2026-11-10" -> "Nov 10"
export function shortDate(isoDay) {
  if (!isoDay) return "";
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// "3 hours ago"
export function timeAgo(iso) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// Safely put text into HTML (prevents broken markup from headlines with < or &).
export function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Only allow http(s) links from feeds.
export function safeUrl(url = "") {
  return /^https?:\/\//i.test(url) ? url : "#";
}
