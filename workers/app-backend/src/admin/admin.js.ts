// T11: same template-string-export pattern as admin.css.ts. T12 adds the
// card behaviors (session-token authenticated fetches against /api/*) —
// this is just the shell's own wiring: the setup-failed banner's Retry
// button reloads the page to re-attempt token exchange + store setup.
export const ADMIN_JS = `document.querySelector("[data-retry-setup]")?.addEventListener("click", () => {
  location.reload();
});
`;
