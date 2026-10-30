let uploadWindow: Window | null = null;

/** Reuse Phoenix's upload window without navigating away from unfinished work. */
export function openRumbleUpload() {
  try {
    if (uploadWindow && !uploadWindow.closed) { uploadWindow.focus(); return true; }
    const opened = window.open("", "phoenix-rumble-upload");
    if (!opened) return false;
    // Disown the opener before loading a third-party page; keep our safe handle.
    opened.opener = null;
    try { if (opened.location.href === "about:blank") opened.location.replace("https://rumble.com/upload"); }
    catch { /* An existing cross-origin named tab is already open: only focus it. */ }
    uploadWindow = opened;
    opened.focus();
    return true;
  } catch { uploadWindow = null; return false; }
}
