"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type UserRecord = { id: string; name: string | null; email: string | null; role: string; createdAt: string };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) throw new Error("The legacy account archive is unavailable. Current local videos and jobs are unaffected.");
      setUsers(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The legacy account archive is unavailable.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <section className="space-y-4 p-8">
    <div className="flex items-center justify-between gap-4">
      <div><h2 className="text-xl font-semibold">Legacy accounts</h2><p className="text-sm text-muted-foreground">Read-only records. Phoenix is a single-owner local studio.</p></div>
      <Button onClick={() => void refresh()} disabled={loading} variant="outline"><RefreshCw className="size-4" />Refresh</Button>
    </div>
    {error ? <p role="alert">{error}</p> : loading ? <p role="status">Loading archive…</p> : users.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr><th scope="col" className="p-3">Name</th><th scope="col" className="p-3">Email</th><th scope="col" className="p-3">Saved role</th><th scope="col" className="p-3">Created</th></tr></thead>
      <tbody>{users.map(user => <tr key={user.id} className="border-t"><td className="p-3">{user.name || "Studio owner"}</td><td className="p-3">{user.email || "—"}</td><td className="p-3">{user.role}</td><td className="p-3">{new Date(user.createdAt).toLocaleDateString()}</td></tr>)}</tbody>
    </table></div> : <p>No saved account records.</p>}
  </section>;
}
