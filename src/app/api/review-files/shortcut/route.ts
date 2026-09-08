import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureReviewFolders, reviewRoot } from "@/lib/reviewFiles";

const execFileAsync = promisify(execFile);
export async function POST() {
  try {
    await ensureReviewFolders();
    if (process.platform !== "win32") return NextResponse.json({ error: "Desktop shortcuts are available on Windows only." }, { status: 409 });
    const destination = `${process.env.USERPROFILE}\\Desktop\\Phoenix Studio Review Files.lnk`;
    const script = "$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut($env:PHOENIX_SHORTCUT_PATH);$s.TargetPath=$env:PHOENIX_REVIEW_ROOT;$s.WorkingDirectory=$env:PHOENIX_REVIEW_ROOT;$s.Save()";
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, PHOENIX_SHORTCUT_PATH: destination, PHOENIX_REVIEW_ROOT: reviewRoot() } });
    return NextResponse.json({ created: true });
  } catch { return NextResponse.json({ error: "Could not create the Desktop shortcut." }, { status: 500 }); }
}
