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
  toggle.addEventListener("click", () => { paused = !video.paused; paused ? video.pause() : video.play().catch(() => {}); sync(); });
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

// The hero board replays the steps of a run for one example idea at a time. It is an illustration, not a live run;
// with reduced motion it shows each example's finished state, and without JS the finished shop counter stays as written.
const run = document.getElementById("run");
if (run) {
  const $ = (id) => document.getElementById(id);
  const examples = {
    shop: {
      name: "Shop counter",
      idea: "A shop counter for my small grocery in Dhaka. Only I sign in, on my phone. It adds up the total in taka, I choose cash or bKash, and the stock goes down.",
      assumptions: 5,
      items: ["Sign in on my phone", "Products and prices in taka", "Ring up a sale", "Pay by cash or bKash", "Stock goes down with each sale", "Cancel a sale"],
      objections: { 5: { gate: "skeptic", say: "The skeptic objected: cancelling a sale must put the stock back.", fixed: "Fixed: a cancelled sale now puts the stock back." } },
      live: "Stage 1 is live at <span class=\"mono\">localhost:3300</span>.",
    },
    family: {
      name: "Family list",
      idea: "A page where my family keeps one shared shopping list.",
      assumptions: 4,
      items: ["Family sign-in", "Invite someone to the family", "Add an item", "Tick an item off", "See who added what", "Clear bought items"],
      objections: { 2: { gate: "lint", say: "Lint failed on “Add an item”. The developer is shown the error.", fixed: "Fixed on the retry: lint is clean." } },
      live: "Live on a public <span class=\"mono\">vercel.app</span> address.",
    },
    tools: {
      name: "Tool lending",
      idea: "A site where neighbours lend each other tools.",
      assumptions: 6,
      items: ["Neighbour sign-in", "List a tool", "Browse tools nearby", "Ask to borrow", "Owner approves a loan", "Mark a tool returned", "Remove a neighbour"],
      objections: {
        4: { gate: "review", say: "The reviewer objected: a loan with no return date could never end.", fixed: "Fixed: every loan now has a return date." },
        6: { gate: "skeptic", say: "The skeptic objected: a removed neighbour could sign up again.", fixed: "Fixed: a removed neighbour stays removed." },
      },
      live: "Stage 1 is live at <span class=\"mono\">localhost:3300</span>.",
    },
  };
  const order = Object.keys(examples);
  const icons = { queued: "○", building: "↗", checking: "◆", failed: "!", passed: "✓" };
  const stop = Symbol("stop");
  let token = 0, current = "shop", paused = false, onScreen = true;

  // Waits count only time the board is playing and on screen; a newer replay cancels an older one.
  const wait = (ms, t) => new Promise((resolve, reject) => {
    if (t !== token) return reject(stop);
    if (calm) return resolve();
    let left = ms;
    const tick = () => {
      if (t !== token) return reject(stop);
      if (!paused && onScreen) left -= 50;
      left <= 0 ? resolve() : setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  });

  const say = (html) => { $("run-say").innerHTML = html; };
  const phase = (name, state) => { for (const li of $("run-phases").children) if (li.textContent === name) li.dataset.state = state; };
  const progress = (done, total) => { $("run-fill").style.setProperty("--p", `${Math.round((done / total) * 100)}%`); $("run-pct").textContent = `${Math.round((done / total) * 100)}%`; };
  const gates = (names) => {
    $("run-gates").replaceChildren(...names.map((n) => Object.assign(document.createElement("span"), { className: "g", textContent: n })));
    return [...$("run-gates").children];
  };
  const row = (title) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="ri-icon" aria-hidden="true"></span><span class="ri-title"></span><span class="ri-status"></span>`;
    li.querySelector(".ri-title").textContent = title;
    $("run-items").append(li);
    return (state, label = state === "failed" ? "sent back" : state) => {
      li.dataset.s = state;
      li.querySelector(".ri-icon").textContent = icons[state];
      li.querySelector(".ri-status").textContent = label;
    };
  };
  // Ticks each gate in turn; an objection stops at its own gate and fails it.
  const check = async (t, judge, failAt) => {
    const chips = gates(["tests", "lint", "build", "scan", "journeys", judge]);
    for (const chip of chips) {
      await wait(130, t);
      if (chip.textContent === failAt) { chip.dataset.g = "fail"; return false; }
      chip.dataset.g = "pass";
    }
    return true;
  };

  const play = async (key) => {
    const t = ++token, ex = examples[key];
    current = key;
    for (const b of $("run-try").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.ex === key));
    $("run-name").textContent = ex.name;
    $("run-pct").classList.remove("is-live");
    $("run-items").replaceChildren();
    for (const li of $("run-phases").children) delete li.dataset.state;
    gates([]);
    const total = 3 + ex.items.length + 1;
    let done = 0;
    progress(0, total);
    try {
      const idea = $("run-idea");
      if (calm) idea.textContent = ex.idea;
      else {
        say("Reading your idea…");
        for (let i = 1; i <= ex.idea.length; i += 2) {
          idea.innerHTML = "";
          idea.append(ex.idea.slice(0, i), Object.assign(document.createElement("span"), { className: "caret" }));
          await wait(16, t);
        }
        idea.textContent = ex.idea;
      }

      phase("Spec", "active"); say("Writing the specification…"); gates(["spec complete"]);
      await wait(900, t);
      $("run-gates").firstChild.dataset.g = "pass"; phase("Spec", "done"); progress(++done, total);
      say(`Spec written. ${ex.assumptions} assumptions recorded; you can correct any of them.`);
      await wait(1300, t);

      phase("Design", "active"); say("Designing who uses it and what each person may do…"); gates(["design sound"]);
      await wait(900, t);
      $("run-gates").firstChild.dataset.g = "pass"; phase("Design", "done"); progress(++done, total);

      phase("Plan", "active"); say(`Planning stage 1 in ${ex.items.length} small pieces…`); gates([]);
      const rows = [];
      for (const title of ex.items) { const set = row(title); set("queued"); rows.push(set); await wait(160, t); }
      phase("Plan", "done"); progress(++done, total);
      await wait(500, t);

      phase("Build", "active");
      for (const [i, title] of ex.items.entries()) {
        const set = rows[i], objection = ex.objections[i];
        set("building"); say(`Building “${title}”…`);
        await wait(550, t);
        set("checking"); say(`Checking “${title}”.`);
        const judge = objection?.gate === "skeptic" ? "skeptic" : "review";
        if (!(await check(t, judge, objection?.gate))) {
          set("failed"); say(objection.say);
          await wait(2200, t);
          set("building", "retrying"); say("Retrying, with the objection quoted and the last attempt shown…");
          await wait(1100, t);
          set("checking"); await check(t, judge);
          set("passed", "passed · 1 fix"); say(objection.fixed);
          await wait(1300, t);
        } else set("passed");
        progress(++done, total);
        await wait(200, t);
      }
      phase("Build", "done");

      phase("Release", "active"); say("Starting a preview, checking it, and testing a rollback…");
      const chips = gates(["preview", "rollback"]);
      for (const chip of chips) { await wait(600, t); chip.dataset.g = "pass"; }
      phase("Release", "done"); progress(++done, total);
      $("run-pct").innerHTML = `<i class="live-dot" aria-hidden="true"></i>Live`;
      $("run-pct").classList.add("is-live");
      say(ex.live);

      if (calm) return;
      await wait(6000, t);
      play(order[(order.indexOf(key) + 1) % order.length]);
    } catch (e) {
      if (e !== stop) throw e;
    }
  };

  const toggle = $("run-toggle");
  $("run-try").hidden = false;
  for (const b of $("run-try").querySelectorAll("button")) b.addEventListener("click", () => { paused = false; toggle.textContent = "Pause"; play(b.dataset.ex); });
  if (!calm) {
    toggle.hidden = false;
    toggle.addEventListener("click", () => { paused = !paused; toggle.textContent = paused ? "Play" : "Pause"; });
    new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }, { threshold: 0.2 }).observe(run);
    play(current);
  }
}

// Gate flow: each gate button shows its own panel of checks; the Proven gate is open to start with.
const gateButtons = document.querySelectorAll(".gate-btn");
for (const btn of gateButtons) {
  btn.addEventListener("click", () => {
    for (const b of gateButtons) b.setAttribute("aria-pressed", String(b === btn));
    for (const panel of document.querySelectorAll("#gate-panel [data-panel]")) panel.hidden = panel.dataset.panel !== btn.dataset.gate;
  });
}
