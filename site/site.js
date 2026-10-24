const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Sections fade in as they scroll into view; without JS (or with reduced motion) they are simply there.
if (!calm && "IntersectionObserver" in window) {
  document.documentElement.classList.add("js");
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("seen"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -10% 0px" });
  for (const el of document.querySelectorAll(".reveal")) io.observe(el);
}

// The demo recording plays while on screen, never for people who asked for less motion, and can always be paused.
const video = document.getElementById("demo");
const toggle = document.getElementById("demo-toggle");
if (video && toggle) {
  let paused = calm;
  const sync = () => { toggle.textContent = video.paused ? "Play" : "Pause"; toggle.setAttribute("aria-pressed", String(video.paused)); };
  toggle.addEventListener("click", () => { paused = !video.paused; paused ? video.pause() : video.play(); });
  video.addEventListener("play", sync);
  video.addEventListener("pause", sync);
  new IntersectionObserver(([e]) => { if (e.isIntersecting && !paused) video.play().catch(() => {}); else video.pause(); }, { threshold: 0.4 }).observe(video);
  sync();
}

// Tabs: each [role=tablist] button names its panel with aria-controls; one panel shows at a time.
for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(tab);
      const next = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
      if (next) { e.preventDefault(); select(next); next.focus(); }
    });
  }
  select(tabs.find((t) => t.getAttribute("aria-selected") === "true") ?? tabs[0]);
}
