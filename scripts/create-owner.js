const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function localDatabaseUrl(value) {
  const candidate = value.trim();
  if (/^file:/i.test(candidate)) {
    throw new Error(
      "This build uses PostgreSQL. Start it locally and set DATABASE_URL to localhost, 127.0.0.1, or ::1.",
    );
  }
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      loopbackHosts.has(parsed.hostname.toLowerCase())
    ) {
      return candidate;
    }
  } catch {
    // The generic local-only error below avoids echoing connection details.
  }
  throw new Error(
    "Remote DATABASE_URL values are disabled in free local mode. Use PostgreSQL on localhost, 127.0.0.1, or ::1.",
  );
}

async function main() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error(
      "Set OWNER_EMAIL and an OWNER_PASSWORD of at least 12 characters",
    );
  }
  const connectionString = localDatabaseUrl(
    process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/auraclip",
  );
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  const hash = await bcrypt.hash(password, 12);
  await db.user.upsert({
    where: { email },
    update: { password: hash, role: "ADMIN" },
    create: { email, password: hash, name: "Owner", role: "ADMIN" },
  });
  await db.$disconnect();
  console.log("Phoenix Studio owner account is ready.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
