import React, { Suspense } from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { LayoutDashboard, Users, RefreshCw, HardDrive, ShieldAlert, Video, Home, Loader2 } from "lucide-react";
import { connection } from "next/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const session = await getServerSession(authOptions);

  // Enforce ADMIN role access control
  if (!session || !session.user || (session.user as any).role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
        <div className="h-16 w-16 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center border border-rose-500/20 mb-6 animate-pulse">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold text-white tracking-tight">Access Restricted</h2>
        <p className="text-xs text-muted-foreground max-w-sm mt-2 leading-relaxed">
          Administrative dashboard is restricted to authorized personnel. Please sign in with an administrator account to continue.
        </p>
        <div className="flex gap-4 mt-6">
          <Link
            href="/"
            className="px-6 py-2 rounded-full bg-white/5 border border-border/40 hover:bg-white/10 hover:text-white transition-all text-xs font-semibold flex items-center gap-1.5"
          >
            <Home className="h-3.5 w-3.5" />
            Home
          </Link>
          <Link
            href="/api/auth/signin"
            className="px-6 py-2 rounded-full bg-violet-600 hover:bg-violet-500 text-white transition-all text-xs font-semibold"
          >
            Sign In as Admin
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar navigation */}
      <aside className="w-64 border-r border-border/40 bg-card/10 backdrop-blur-md flex flex-col justify-between p-6 shrink-0">
        <div className="space-y-8">
          {/* Brand Logo */}
          <div className="flex items-center justify-between">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 shadow-md">
                <Video className="h-4.5 w-4.5 text-white" />
              </div>
              <span className="text-base font-bold text-white tracking-tight">
                AuraClip Admin
              </span>
            </Link>
          </div>

          {/* Nav Items */}
          <nav className="space-y-2">
            <Link
              href="/admin"
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <LayoutDashboard className="h-4 w-4 text-violet-400" />
              Overview Analytics
            </Link>
            <Link
              href="/admin/users"
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <Users className="h-4 w-4 text-violet-400" />
              User Management
            </Link>
            <Link
              href="/admin/exports"
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <RefreshCw className="h-4 w-4 text-violet-400" />
              Render Queue Monitor
            </Link>
            <Link
              href="/admin/storage"
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <HardDrive className="h-4 w-4 text-violet-400" />
              Storage Management
            </Link>
          </nav>
        </div>

        {/* Footer info */}
        <div className="text-[10px] text-muted-foreground font-mono leading-normal border-t border-border/20 pt-4 space-y-1">
          <p>Role: Administrator</p>
          <p>Scope: Global Sandbox</p>
          <Link href="/dashboard" className="text-violet-400 hover:underline block mt-2">
            Back to Dashboard
          </Link>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-screen overflow-y-auto bg-slate-950">
        <Suspense
          fallback={
            <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground font-medium">
              <Loader2 className="h-6 w-6 animate-spin mb-2 text-violet-500" />
              Loading admin dashboard...
            </div>
          }
        >
          {children}
        </Suspense>
      </main>
    </div>
  );
}
