// T14: small shared interactivity — the in-page confirm pattern for
// action buttons (the plan explicitly rules out window.confirm) and the
// events explorer's auto-refresh toggle. Untested DOM wiring, same
// convention as the merchant admin page's admin.js.ts.
export const CONSOLE_JS = `function wireConfirmForms() {
  document.querySelectorAll("[data-confirm-form]").forEach((form) => {
    const trigger = form.querySelector("[data-confirm-trigger]");
    const inline = form.querySelector("[data-confirm-inline]");
    const cancel = form.querySelector("[data-confirm-cancel]");
    if (!trigger || !inline) return;
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      trigger.hidden = true;
      inline.hidden = false;
    });
    cancel?.addEventListener("click", () => {
      trigger.hidden = false;
      inline.hidden = true;
    });
  });
}

function wireAutoRefresh() {
  const toggle = document.querySelector("[data-auto-refresh]");
  if (!toggle) return;
  const params = new URLSearchParams(location.search);
  if (params.get("auto") === "1") {
    toggle.checked = true;
    setInterval(() => location.reload(), 5000);
  }
  toggle.addEventListener("change", () => {
    const p = new URLSearchParams(location.search);
    if (toggle.checked) p.set("auto", "1");
    else p.delete("auto");
    location.search = p.toString();
  });
}

if (typeof document !== "undefined") {
  wireConfirmForms();
  wireAutoRefresh();
}
`;
