const pages = {
  upload: { href: "https://rumble.com/upload", target: "phoenix-rumble-upload" },
  dashboard: { href: "https://rumble.com/account/dashboard", target: "phoenix-rumble-dashboard" },
} as const;
const windows: Record<keyof typeof pages, Window | null> = { upload: null, dashboard: null };

function openRumbleWindow(destination: keyof typeof pages, fresh = false) {
  try {
    const existing = windows[destination], page = pages[destination];
    if (existing && !existing.closed) {
      if (fresh) existing.location.replace(page.href);
      existing.focus();
      return true;
    }
    const opened = window.open("", page.target);
    if (!opened) return false;
    // Disown the opener before loading a third-party page; keep our safe handle.
    opened.opener = null;
    try { if (fresh || opened.location.href === "about:blank") opened.location.replace(page.href); }
    catch { if (fresh) return false; /* Otherwise focus the existing cross-origin tab. */ }
    windows[destination] = opened;
    opened.focus();
    return true;
  } catch { windows[destination] = null; return false; }
}

/** Reuse Phoenix's upload window without navigating away from unfinished work. */
export function openRumbleUpload() { return openRumbleWindow("upload"); }

function rumbleLink(destination: keyof typeof pages) {
  return {
    ...pages[destination],
    rel: "noopener noreferrer",
    onClick(event: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }) {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (openRumbleWindow(destination, destination === "upload")) event.preventDefault();
    },
  };
}

export const rumbleDashboardLink = rumbleLink("dashboard");
export const rumbleUploadLink = rumbleLink("upload");
