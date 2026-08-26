const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

require("ts-node").register({
  compilerOptions: {
    module: "commonjs",
  },
});

const { db } = require("./src/lib/db.ts");

async function main() {
  const users = await db.user.findMany({
    include: {
      publishSettings: true,
    }
  });
  console.log("USERS AND SETTINGS:", JSON.stringify(users, null, 2));

  const histories = await db.publishHistory.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log("LATEST PUBLISH HISTORIES:", JSON.stringify(histories, null, 2));
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
