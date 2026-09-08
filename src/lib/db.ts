import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type DatabaseConfig =
  | { connectionString: string; error?: never }
  | { connectionString?: never; error: string };

function databaseConfig(value: string | undefined): DatabaseConfig {
  if (!value?.trim()) {
    return {
      error:
        "Local database features are unavailable until DATABASE_URL points to loopback PostgreSQL.",
    };
  }

  const candidate = value.trim();
  if (/^file:/i.test(candidate)) {
    return {
      error:
        "This build uses PostgreSQL and cannot open a file: SQLite DATABASE_URL. Start PostgreSQL locally and use localhost, 127.0.0.1, or ::1.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      error:
        "DATABASE_URL must use PostgreSQL on localhost, 127.0.0.1, or ::1.",
    };
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return {
      error:
        "Only a loopback PostgreSQL DATABASE_URL is supported in free local mode.",
    };
  }
  if (!loopbackHosts.has(parsed.hostname.toLowerCase())) {
    return {
      error:
        "Remote DATABASE_URL values are disabled in free local mode. Use PostgreSQL on localhost, 127.0.0.1, or ::1.",
    };
  }
  return { connectionString: candidate };
}

function disabledDatabase(message: string): PrismaClient {
  const fail = new Proxy(
    () => {
      throw new Error(message);
    },
    {
      get(_target, property) {
        if (property === "then") return undefined;
        return fail;
      },
      apply() {
        throw new Error(message);
      },
    },
  );

  return new Proxy({} as PrismaClient, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === "$disconnect") return async () => undefined;
      return fail;
    },
  });
}

const config = databaseConfig(process.env.DATABASE_URL);

export const db = config.error
  ? disabledDatabase(config.error)
  : globalForPrisma.prisma ||
    new PrismaClient({
      adapter: new PrismaPg({ connectionString: config.connectionString }),
    });

if (process.env.NODE_ENV !== "production" && !config.error) {
  globalForPrisma.prisma = db;
}
