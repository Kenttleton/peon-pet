// Tooltip window's own tiny script — a separate, always-on-top window so
// the tooltip can never be clipped by the main pet window's own bounds
// (an OS window is a hard rectangular canvas; nothing renders past its
// edge regardless of CSS overflow). main.js owns show/hide/position; this
// just renders whatever HTML it's given and reports its natural size back
// so main.js can size the actual window to fit exactly.
const el = document.getElementById('tt');

function reportSize() {
  const rect = el.getBoundingClientRect();
  window.tooltipBridge.reportSize({
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
  });
}

window.tooltipBridge.onShow((html) => {
  el.innerHTML = html;
  // Measure synchronously — getBoundingClientRect() forces a layout flush
  // on demand, so no animation frame is needed. That matters here because
  // requestAnimationFrame never fires for a hidden window (same throttling
  // that pauses a backgrounded tab), and this window is hidden between
  // every hover — deferring to rAF would mean it only ever shows once.
  reportSize();
});
