"use strict";

import React, { Suspense } from "react";
import { Loader2 } from "lucide-react";
import AdminExportsClient from "./AdminExportsClient";
import { connection } from "next/server";

export default async function AdminExportsPage() {
  await connection();
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground font-medium bg-slate-950">
          <Loader2 className="h-6 w-6 animate-spin mb-2 text-violet-500" />
          Loading Exports Queue...
        </div>
      }
    >
      <AdminExportsClient />
    </Suspense>
  );
}
