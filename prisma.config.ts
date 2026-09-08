import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/auraclip";
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopbackPostgres(value: string) {
  const candidate = value.trim();
  if (/^file:/i.test(candidate)) return false;
  try {
    const parsed = new URL(candidate);
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      loopbackHosts.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

if (!isLoopbackPostgres(databaseUrl)) {
  throw new Error(
    "Only loopback PostgreSQL is supported in free local mode. Use localhost, 127.0.0.1, or ::1; file: SQLite and remote databases are disabled.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
});
