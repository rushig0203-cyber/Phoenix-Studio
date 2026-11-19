export default function LoadingStudio() {
  return <div className="studio-loading">
    <aside aria-hidden="true"><div className="studio-loading-brand"><span className="studio-brand-mark">P</span>Phoenix Studio</div></aside>
    <main className="studio-loading-content" aria-busy="true">
      <h1>Your studio</h1>
      <p role="status"><span className="studio-loading-dot" aria-hidden="true" />Opening your workspace…</p>
      <div className="studio-loading-lines" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <div key={index}><i /><i /><i /></div>)}
      </div>
    </main>
  </div>;
}
