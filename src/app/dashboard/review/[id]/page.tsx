import ReviewClient from "./ReviewClient";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewClient projectId={id} />;
}
