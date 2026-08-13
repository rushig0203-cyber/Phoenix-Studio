import { redirect } from "next/navigation";

export default async function UltimateProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/project/${id}/editor`);
}
