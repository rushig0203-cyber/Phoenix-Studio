function Repair-PhoenixAbandonedPublicationLocks([string]$Root, [string]$ReviewId) {
    try {
        if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $ReviewId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { return $false }
        $Root = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
        $publications = Join-Path $Root 'storage\private\review-publications'
        foreach ($directory in @($Root, (Join-Path $Root 'storage'), (Join-Path $Root 'storage\private'), $publications)) {
            $item = Get-Item -LiteralPath $directory -Force -ErrorAction Stop
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $false }
        }
        $story = Join-Path $publications ($ReviewId + '-instagram-story.json')
        $reel = Join-Path $publications ($ReviewId + '-instagram.json')
        $locks = @(($story + '.lock'), ($story + '.operation.lock'), ($reel + '.lock'), ($reel + '.operation.lock'),
            (Join-Path $publications '.publication-stream.lock'), (Join-Path $Root 'storage\private\channels.enc.lock'))
        $existing = @($locks | Where-Object { Test-Path -LiteralPath $_ -ErrorAction Stop })
        if (-not $existing.Count) { return $true }
        if (-not ('Phoenix.SafePostingLockRecovery' -as [type])) {
            # Exclusive handle sharing denies replacement during validation. Delete
            # the validated handle itself, never a path that could hold a successor.
            # https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-createfilew
            # https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle
            Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;
namespace Phoenix {
    public static class SafePostingLockRecovery {
        [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low, High; }
        [StructLayout(LayoutKind.Sequential)] struct FileInfo {
            public uint Attributes; public FileTime Created, Accessed, Written;
            public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }
        [StructLayout(LayoutKind.Sequential)] struct Disposition { [MarshalAs(UnmanagedType.U1)] public bool Delete; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool ReadFile(SafeFileHandle handle, byte[] bytes, uint count, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetFileInformationByHandle(SafeFileHandle handle, int kind, ref Disposition value, uint size);

        public static bool Recover(string filename) {
            try {
                // GENERIC_READ | DELETE, no sharing, OPEN_EXISTING, inspect reparse points.
                using (SafeFileHandle handle = CreateFileW(filename, 0x80010000, 0, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
                    if (handle.IsInvalid) return Marshal.GetLastWin32Error() == 2;
                    FileInfo info;
                    if (!GetFileInformationByHandle(handle, out info) || (info.Attributes & 0x410) != 0 || info.Links != 1 || info.SizeHigh != 0 || info.SizeLow > 64) return false;
                    StringBuilder actual = new StringBuilder(32768);
                    uint length = GetFinalPathNameByHandleW(handle, actual, (uint)actual.Capacity, 0);
                    if (length == 0 || length >= actual.Capacity || !String.Equals(actual.ToString(), @"\\?\" + Path.GetFullPath(filename), StringComparison.OrdinalIgnoreCase)) return false;
                    long written = ((long)info.Written.High << 32) | info.Written.Low;
                    if ((DateTime.UtcNow - DateTime.FromFileTimeUtc(written)).TotalSeconds <= 60) return false;
                    byte[] bytes = new byte[64]; uint read;
                    if (!ReadFile(handle, bytes, info.SizeLow, out read, IntPtr.Zero) || read != info.SizeLow) return false;
                    string token = Encoding.ASCII.GetString(bytes, 0, (int)read);
                    Match match = Regex.Match(token, @"\A([1-9]\d{0,9})-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\z");
                    int pid;
                    if (!match.Success || !Int32.TryParse(match.Groups[1].Value, out pid)) return false;
                    try { using (Process owner = Process.GetProcessById(pid)) { if (!owner.HasExited) return false; } }
                    catch (ArgumentException) { /* No process has this PID. */ }
                    catch { return false; }
                    Disposition disposition = new Disposition { Delete = true };
                    return SetFileInformationByHandle(handle, 4, ref disposition, (uint)Marshal.SizeOf(typeof(Disposition)));
                }
            } catch { return false; }
        }
    }
}
'@ -ErrorAction Stop
        }
        foreach ($filename in $existing) { if (-not [Phoenix.SafePostingLockRecovery]::Recover($filename)) { return $false } }
        return $true
    } catch { return $false }
}
