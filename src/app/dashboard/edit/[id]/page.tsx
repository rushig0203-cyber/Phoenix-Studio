import ReviewEditor from "@/components/ReviewEditor";
export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReviewEditor id={(await params).id} />;
}
