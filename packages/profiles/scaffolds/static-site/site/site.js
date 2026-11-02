// Small touches that need no library. Keep the site working with this file switched off.
for (const el of document.querySelectorAll("[data-year]")) el.textContent = String(new Date().getFullYear());
