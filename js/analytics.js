// ------------------------------------------------------------------
// Google Analytics 4
// ------------------------------------------------------------------
// Paste your Measurement ID (looks like "G-XXXXXXXXXX") below.
// While it's empty, nothing is loaded and no data is sent.
// Visits from localhost are ignored so testing doesn't count.
// ------------------------------------------------------------------

const GA_MEASUREMENT_ID = "G-QMXGBSL7ZG";

if (GA_MEASUREMENT_ID && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID, { anonymize_ip: true });
}

// Lets app.js report which tabs people open (shows up as "tab_view" events in GA).
export function trackTab(tabName) {
  if (window.gtag) window.gtag("event", "tab_view", { tab_name: tabName });
}
