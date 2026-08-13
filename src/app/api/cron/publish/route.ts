import { NextResponse } from "next/server"; import { processScheduledPublishes } from "@/lib/scheduler";
export async function GET(req:Request){if(req.headers.get("authorization")!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:"Unauthorized"},{status:401});return NextResponse.json({processed:await processScheduledPublishes()});}
