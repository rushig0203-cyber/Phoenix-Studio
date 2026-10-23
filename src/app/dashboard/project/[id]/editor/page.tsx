export default function LegacyEditorPage() {
  return <main className="min-h-screen bg-[#f4f0e7] px-5 py-12 text-[#1e2719]">
    <section className="mx-auto max-w-xl rounded-2xl border border-[#c4cfb5] bg-[#fffdf7] p-6">
      <h1 className="text-2xl font-semibold">Use the current video editor</h1>
      <p className="mt-4 text-sm leading-6">The old browser editor has been retired. Open Library and choose Edit video on a finished video.</p>
      <p className="mt-3 text-sm leading-6 text-[#59634d]">Your previously saved project files and timelines have not been deleted or changed. They are not automatically converted.</p>
      <a href="/dashboard#library" className="mt-5 inline-block rounded-lg bg-[#394a2a] px-4 py-2 text-sm font-semibold text-white">Open Library</a>
    </section>
  </main>;
}
