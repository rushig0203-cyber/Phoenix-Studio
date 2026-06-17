const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

require("ts-node").register({
  compilerOptions: {
    module: "commonjs",
  },
});

const { db } = require("./src/lib/db.ts");

async function main() {
  const projects = await db.project.findMany({
    include: {
      videos: true,
      exports: true,
      clips: true,
    },
  });

  console.log(`TOTAL PROJECTS: ${projects.length}`);
  for (const p of projects) {
    console.log(`- Project: ${p.id} | Title: "${p.title}" | Status: ${p.status}`);
    if (p.title.includes("Vlog 12")) {
      console.log("MATCH:", JSON.stringify(p, null, 2));
    }
  }
}

main().catch(console.error);
