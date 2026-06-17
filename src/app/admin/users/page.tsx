"use client";

import React, { useEffect, useState } from "react";
import { Shield, Coins, Edit2, Check, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UserRecord {
  id: string;
  name: string | null;
  email: string | null;
  role: "USER" | "ADMIN";
  remainingMins: number;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<"USER" | "ADMIN">("USER");
  const [editCredits, setEditCredits] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (Array.isArray(data)) {
        setUsers(data);
      }
    } catch (err) {
      console.error("Failed to fetch users:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const startEdit = (user: UserRecord) => {
    setEditingUserId(user.id);
    setEditRole(user.role);
    setEditCredits(user.remainingMins.toFixed(1));
  };

  const cancelEdit = () => {
    setEditingUserId(null);
  };

  const saveEdit = async (userId: string) => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          role: editRole,
          remainingMins: parseFloat(editCredits) || 0,
        }),
      });

      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? { ...u, role: editRole, remainingMins: parseFloat(editCredits) || 0 }
              : u
          )
        );
        setEditingUserId(null);
      }
    } catch (err) {
      console.error("Failed to save changes:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-border/40 pb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">User Management</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Review registered user parameters, adjust credit balances, or allocate system roles.
          </p>
        </div>
        <Button
          onClick={fetchUsers}
          disabled={isLoading}
          variant="outline"
          className="h-9 text-xs rounded-full border-border/40 hover:bg-white/5 gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh Directory
        </Button>
      </div>

      {/* Users Table */}
      <div className="bg-slate-900/40 border border-border/30 rounded-xl overflow-hidden shadow-lg">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground text-xs font-semibold animate-pulse">
            Fetching user registry data...
          </div>
        ) : users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/20 text-muted-foreground font-semibold bg-white/[0.02]">
                  <th className="p-4">Creator / Name</th>
                  <th className="p-4">Email Address</th>
                  <th className="p-4">System Role</th>
                  <th className="p-4">Curation Credits</th>
                  <th className="p-4">Registered On</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/10">
                {users.map((user) => {
                  const isEditing = editingUserId === user.id;
                  return (
                    <tr key={user.id} className="hover:bg-white/[0.01] transition-colors">
                      <td className="p-4 font-bold text-white">
                        <div className="flex items-center gap-3">
                          <div className="h-7 w-7 rounded-full bg-violet-600/20 text-violet-400 flex items-center justify-center font-bold">
                            {(user.name || user.email || "U").charAt(0).toUpperCase()}
                          </div>
                          <span>{user.name || "Default Creator"}</span>
                        </div>
                      </td>
                      <td className="p-4 text-slate-300 font-mono">{user.email}</td>
                      <td className="p-4">
                        {isEditing ? (
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value as any)}
                            className="rounded bg-slate-950 border border-border/40 px-2 py-1 text-xs text-white"
                          >
                            <option value="USER">USER</option>
                            <option value="ADMIN">ADMIN</option>
                          </select>
                        ) : (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            user.role === "ADMIN"
                              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              : "bg-slate-500/10 text-slate-300 border border-border/20"
                          }`}>
                            <Shield className="h-3 w-3" />
                            {user.role}
                          </span>
                        )}
                      </td>
                      <td className="p-4 font-mono font-semibold text-white">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              value={editCredits}
                              onChange={(e) => setEditCredits(e.target.value)}
                              className="w-20 rounded bg-slate-950 border border-border/40 px-2 py-1 text-xs text-white"
                            />
                            <span className="text-[10px] text-muted-foreground">mins</span>
                          </div>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <Coins className="h-3.5 w-3.5 text-violet-400" />
                            {user.remainingMins.toFixed(1)} mins
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => saveEdit(user.id)}
                              disabled={isSaving}
                              className="h-7 w-7 rounded-md text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={cancelEdit}
                              disabled={isSaving}
                              className="h-7 w-7 rounded-md text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(user)}
                            className="h-8 rounded-lg hover:bg-white/5 text-violet-400 hover:text-violet-300 gap-1"
                          >
                            <Edit2 className="h-3 w-3" />
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground text-xs leading-relaxed">
            No registered users found. Try registering an account.
          </div>
        )}
      </div>
    </div>
  );
}
