import Link from "next/link";
import {
  ArrowLeft,
  HardDrive,
  LayoutDashboard,
  RefreshCw,
  Users,
} from "lucide-react";

const links = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/exports", label: "Exports", icon: RefreshCw },
  { href: "/admin/storage", label: "Storage", icon: HardDrive },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-shell flex min-h-screen bg-[#f7f7f5] text-slate-900">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-5 md:flex md:flex-col">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          AuraClip
        </Link>
        <p className="mt-1 text-xs text-slate-500">Studio tools</p>
        <nav className="mt-8 space-y-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <Link href="/dashboard" className="mt-auto flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Back to studio
        </Link>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto bg-[#f7f7f5]">{children}</main>
    </div>
  );
}
