import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { startScheduler } from "./scheduler";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Connect directly to our file-based SQLite database
const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL || "file:./dev.db",
});

export const db =
  globalForPrisma.prisma ||
  new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

// Start background task runner scheduler on server initialization
if (typeof window === "undefined") {
  startScheduler();
}

