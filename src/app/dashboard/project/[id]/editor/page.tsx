import EditorWorkspace from "./workspace";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorWorkspace projectId={id} />;
}
