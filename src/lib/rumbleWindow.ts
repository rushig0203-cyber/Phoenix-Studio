const pages = {
  upload: { href: "https://rumble.com/upload", target: "phoenix-rumble-upload" },
  dashboard: { href: "https://rumble.com/account/dashboard", target: "phoenix-rumble-dashboard" },
} as const;
const windows: Record<keyof typeof pages, Window | null> = { upload: null, dashboard: null };

function openRumbleWindow(destination: keyof typeof pages) {
  try {
    const existing = windows[destination], page = pages[destination];
    if (existing && !existing.closed) { existing.focus(); return true; }
    const opened = window.open("", page.target);
    if (!opened) return false;
    // Disown the opener before loading a third-party page; keep our safe handle.
    opened.opener = null;
    try { if (opened.location.href === "about:blank") opened.location.replace(page.href); }
    catch { /* An existing cross-origin named tab is already open: only focus it. */ }
    windows[destination] = opened;
    opened.focus();
    return true;
  } catch { windows[destination] = null; return false; }
}

/** Reuse Phoenix's upload window without navigating away from unfinished work. */
export function openRumbleUpload() { return openRumbleWindow("upload"); }

export const rumbleDashboardLink = {
  ...pages.dashboard,
  rel: "noopener noreferrer",
  onClick(event: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    // Keep the real link usable when popups are blocked or the user opens it separately.
    if (openRumbleWindow("dashboard")) event.preventDefault();
  },
};
