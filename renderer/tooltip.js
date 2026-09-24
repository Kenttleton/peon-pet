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
  // Let layout settle before measuring the new content's natural size.
  requestAnimationFrame(reportSize);
});
