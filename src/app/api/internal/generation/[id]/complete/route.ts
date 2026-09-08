import { NextResponse } from "next/server";

// The local worker polls MoneyPrinterTurbo directly.  This retired webhook is
// intentionally disabled so an old cloud callback cannot create an output.
export async function POST(){return NextResponse.json({error:"Cloud completion callbacks are disabled; use the local worker."},{status:410})}
