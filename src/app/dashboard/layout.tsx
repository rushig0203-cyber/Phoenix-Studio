import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
export default async function DashboardLayout({children}:{children:React.ReactNode}){await connection();const session=await getServerSession(authOptions);if(!session?.user)redirect("/login?callbackUrl=/dashboard");return children;}
