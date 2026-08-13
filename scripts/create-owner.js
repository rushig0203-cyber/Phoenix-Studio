const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());
const { PrismaClient } = require("@prisma/client");
const { PrismaLibSql } = require("@prisma/adapter-libsql");
const bcrypt = require("bcryptjs");
async function main(){const email=process.env.OWNER_EMAIL;const password=process.env.OWNER_PASSWORD;if(!email||!password||password.length<12)throw new Error("Set OWNER_EMAIL and an OWNER_PASSWORD of at least 12 characters");const db=new PrismaClient({adapter:new PrismaLibSql({url:process.env.DATABASE_URL||"file:./dev.db"})});const hash=await bcrypt.hash(password,12);await db.user.upsert({where:{email},update:{password:hash,role:"ADMIN"},create:{email,password:hash,name:"Owner",role:"ADMIN"}});await db.$disconnect();console.log(`AuraClip owner ready: ${email}`)}main().catch(error=>{console.error(error.message);process.exit(1)});
