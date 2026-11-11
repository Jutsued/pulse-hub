// ------------------------------------------------------------------
// Chart helpers — thin wrappers around Chart.js so app.js stays short.
// Chart.js is loaded from a CDN in index.html and lives on window.Chart.
// ------------------------------------------------------------------

import { COLORS } from "./format.js";

const charts = {}; // remember charts by canvas id so we can redraw them

// Shared look for every chart.
function applyDefaults() {
  const Chart = window.Chart;
  Chart.defaults.font.family = '"Archivo", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = COLORS.inkSoft;
  Chart.defaults.borderColor = COLORS.rule;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.tooltip.backgroundColor = COLORS.ink;
  Chart.defaults.maintainAspectRatio = false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) Chart.defaults.animation = false;
}

let defaultsApplied = false;

// Creates a chart, or replaces the old one on the same canvas.
export function draw(canvasId, config) {
  if (!window.Chart) return null;
  if (!defaultsApplied) {
    applyDefaults();
    defaultsApplied = true;
  }
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  charts[canvasId] = new window.Chart(canvas, config);
  return charts[canvasId];
}

// Tiny line with no axes — used in the index strip and crypto list.
export function sparkline(canvas, values, color) {
  if (!window.Chart || !canvas || !values?.length) return;
  new window.Chart(canvas, {
    type: "line",
    data: {
      labels: values.map((_, i) => i),
      datasets: [{ data: values, borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false }],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

// Horizontal bar chart where each bar is green (positive) or red (negative).
export function signedBars(canvasId, labels, values, { suffix = "", digits = 2, horizontal = true } = {}) {
  return draw(canvasId, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: values.map((v) => (v >= 0 ? COLORS.greed : COLORS.fear)),
          borderRadius: 3,
          maxBarThickness: 26,
        },
      ],
    },
    options: {
      indexAxis: horizontal ? "y" : "x",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${Number(ctx.raw).toFixed(digits)}${suffix}` } },
      },
      scales: {
        [horizontal ? "x" : "y"]: {
          grid: { color: (ctx) => (ctx.tick.value === 0 ? COLORS.inkSoft : COLORS.rule) },
          ticks: { callback: (v) => `${v}${suffix}` },
        },
        [horizontal ? "y" : "x"]: { grid: { display: false } },
      },
    },
  });
}
