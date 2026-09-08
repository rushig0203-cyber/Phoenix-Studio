import QualityManager from "@/components/QualityManager";
export default async function ManagerPage({ searchParams }: {searchParams:Promise<{review?:string}>}) {
  const {review}=await searchParams;
  return <QualityManager initialReviewId={review}/>;
}
