"use client";

import { useEffect } from "react";

/**
 * Karigor's edit mode. Inside Karigor's preview (and only when that page switches it on)
 * the person points at a part of a page, drags it among its neighbours, edits its words or drops a
 * photo on it. Nothing changes in the app from here: each gesture is sent to Karigor as a precise
 * change request, which is built, tested and released like any other change.
 * Outside a frame this does nothing. Only Karigor's preview (KARIGOR_EDITOR_ORIGIN) or the app itself may
 * frame the app (middleware.ts), so the page around it is trusted, and answers go to that page alone.
 * Keep it in app/layout.tsx.
 */
export function KarigorEdit() {
  useEffect(() => {
    if (window.parent === window) return;
    let on = false;
    let editor = "";
    let dragged: HTMLElement | null = null;
    const box = document.createElement("div");
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3442d9;border-radius:6px;background:rgba(52,66,217,.08);display:none;transition:all .08s";
    document.body.appendChild(box);

    const send = (msg: Record<string, unknown>) => editor && window.parent.postMessage({ ...msg, page: location.pathname }, editor);
    const BLOCK = "[data-k],h1,h2,h3,p,li,button,a,img,label,th,td,input,select,textarea,nav";
    const target = (e: Event) => ((e.target as Element | null)?.closest?.(BLOCK) as HTMLElement | null) ?? null;
    /** What a part is, in words Karigor and its developer can find it by. */
    // A button, link, picture, input, list item or table cell is a part of its own; other text (a label,
    // a heading, a paragraph) belongs to the marked block around it (a Field, a Card).
    const OWN = new Set(["button", "a", "img", "input", "select", "textarea", "li", "td", "th", "nav"]);
    const WORD: Record<string, string> = { a: "link", img: "picture", li: "list item", td: "table cell", th: "table heading", nav: "menu" };
    const describe = (el: HTMLElement) => {
      const tag = el.tagName.toLowerCase();
      const own = !el.dataset.k && OWN.has(tag);
      const k = own ? null : el.closest<HTMLElement>("[data-k]");
      const same = k?.parentElement ? [...k.parentElement.children].filter((c) => (c as HTMLElement).dataset.k === k.dataset.k) : [];
      const inside = (own ? el : k?.parentElement)?.closest<HTMLElement>("[data-k]");
      return {
        kind: k?.dataset.k ?? WORD[tag] ?? tag,
        name: k?.dataset.kName ?? el.getAttribute("aria-label") ?? el.getAttribute("alt") ?? undefined,
        text: (el.innerText || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 120),
        position: k && same.length > 1 ? `${same.indexOf(k) + 1} of ${same.length}` : undefined,
        inside: inside ? `${inside.dataset.k} "${inside.dataset.kName ?? ""}"` : undefined,
      };
    };
    const show = (el: HTMLElement | null) => {
      if (!el) return void (box.style.display = "none");
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { display: "block", top: `${r.top - 3}px`, left: `${r.left - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    };
    const movable = () => document.querySelectorAll<HTMLElement>("[data-k]").forEach((el) => (el.draggable = on));

    /** The block a gesture is about: the part itself when it stands on its own, else the marked block around it. */
    const block = (el: HTMLElement | null) => (!el || el.dataset.k || OWN.has(el.tagName.toLowerCase()) ? el : (el.closest<HTMLElement>("[data-k]") ?? el));
    const over = (e: MouseEvent) => on && show(block(target(e)));
    const click = (e: MouseEvent) => {
      if (!on) return;
      const el = target(e);
      if (!el) return;
      // In edit mode a click points; it never follows a link or submits a form.
      e.preventDefault();
      e.stopPropagation();
      send({ type: "karigor:pick", target: describe(el) });
    };
    const dblclick = (e: MouseEvent) => {
      if (!on) return;
      const el = target(e);
      if (!el || el.children.length > 2 || !el.innerText.trim()) return;
      e.preventDefault();
      const before = el.innerText.trim();
      el.contentEditable = "true";
      el.focus();
      el.addEventListener("blur", () => {
        el.contentEditable = "false";
        const after = el.innerText.trim();
        if (after && after !== before) send({ type: "karigor:text", target: describe(el), before, after });
      }, { once: true });
    };
    const dragstart = (e: DragEvent) => {
      if (!on) return;
      dragged = (e.target as Element).closest<HTMLElement>("[data-k]");
      if (dragged && e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };
    const dragover = (e: DragEvent) => {
      if (!on) return;
      e.preventDefault();
      const el = (e.target as Element).closest<HTMLElement>("[data-k]");
      show(el && dragged && el !== dragged && el.parentElement === dragged.parentElement ? el : target(e));
    };
    const drop = (e: DragEvent) => {
      if (!on) return;
      e.preventDefault();
      show(null);
      const file = e.dataTransfer?.files?.[0];
      const el = target(e);
      if (file && el) return void send({ type: "karigor:file", target: describe(el), file });
      const onto = (e.target as Element).closest<HTMLElement>("[data-k]");
      if (!dragged || !onto || onto === dragged || onto.parentElement !== dragged.parentElement) return void (dragged = null);
      const siblings = [...onto.parentElement!.children];
      const after = siblings.indexOf(dragged) < siblings.indexOf(onto);
      // Described as they are now (positions before the move), so the request names what is really there.
      const msg = { type: "karigor:move", target: describe(dragged), [after ? "after" : "before"]: describe(onto) };
      // Shown at once, so the person sees what they asked for; the real change comes with the next release.
      onto.insertAdjacentElement(after ? "afterend" : "beforebegin", dragged);
      send(msg);
      dragged = null;
    };
    const message = (e: MessageEvent) => {
      if (e.source !== window.parent || e.data?.type !== "karigor:edit") return;
      editor = e.origin;
      on = !!e.data.on;
      movable();
      if (!on) show(null);
    };

    const opts = { capture: true };
    window.addEventListener("message", message);
    document.addEventListener("mouseover", over, opts);
    document.addEventListener("click", click, opts);
    document.addEventListener("dblclick", dblclick, opts);
    document.addEventListener("dragstart", dragstart, opts);
    document.addEventListener("dragover", dragover, opts);
    document.addEventListener("drop", drop, opts);
    // Says only that it is ready (no page content), so it may go to whoever frames it.
    window.parent.postMessage({ type: "karigor:ready", page: location.pathname }, "*");
    return () => {
      window.removeEventListener("message", message);
      for (const [n, f] of [["mouseover", over], ["click", click], ["dblclick", dblclick], ["dragstart", dragstart], ["dragover", dragover], ["drop", drop]] as const) document.removeEventListener(n, f as EventListener, opts);
      box.remove();
    };
  }, []);
  return null;
}
