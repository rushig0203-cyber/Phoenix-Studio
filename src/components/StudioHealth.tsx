import WritingProviderSettings from "./WritingProviderSettings";
export type StudioHealthState = {
  worker: { state: string; heartbeatAt?: string };
  resources: { reason: string; busy: boolean; waitingForMemory: boolean; freeMiB: number };
  build: string;
  services?: import("@/lib/localServiceHealth").LocalServices;
};

/** A queued request is not proof that the worker is alive. */
export default function StudioHealth({ health, detailed = true }: { health: StudioHealthState | null; detailed?: boolean }) {
  // Monitoring continues in DashboardClient; routine status belongs in Settings.
  if (!detailed) {
    const warnings: string[] = [];
    if (!health) warnings.push("Studio health is not confirmed.");
    else {
      if (health.worker.state === "offline") warnings.push("Lumina is offline; queued jobs cannot start.");
      else if (health.worker.state !== "healthy") warnings.push("Lumina is not responding; avoid submitting duplicate jobs.");
      if (health.resources.waitingForMemory) warnings.push("Processing is waiting for available memory.");
      const writer = health.services?.writer || health.services?.ollama;
      if (writer && ["offline", "blocked"].includes(writer.state)) warnings.push("The script writer needs attention.");
      if (health.services && ["offline", "blocked"].includes(health.services.renderer.state)) warnings.push("The video renderer needs attention.");
    }
    return warnings.length ? <p role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{warnings.join(" ")} <a className="underline" href="#settings">Open Settings</a></p> : null;
  }
  if (!health) return <p role="status" className="mb-4 rounded-xl border bg-white p-3 text-sm">Studio health is not confirmed. Check the live-data notice before expecting queued work to start.</p>;
  const stopped = health.worker.state !== "healthy";
  return <section aria-label="Studio health" className={`mb-4 rounded-xl border p-3 text-sm ${stopped || health.resources.waitingForMemory ? "border-amber-300 bg-amber-50 text-amber-950" : "border-[#d3dbc5] bg-[#f5f8ef] text-[#48573b]"}`}>
    <p role="status">{stopped ? health.worker.state === "offline" ? "Lumina manager is offline. Queued jobs are saved but cannot start." : "Lumina manager is not responding. Existing work may still be running; do not submit a duplicate." : "Lumina manager connected — handling submitted jobs automatically."} {health.resources.reason}.</p>
    {stopped ? <p className="mt-1">Open the Phoenix Studio desktop shortcut to check/start the services. It keeps saved jobs and completed videos.</p> : null}
    {health.services ? <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">{([[health.services.writerProvider === 'groq' ? 'Groq writer' : 'Ollama writer', health.services.writer || health.services.ollama], ['MoneyPrinterTurbo', health.services.renderer]] as const).map(([name, service]) => <p key={name} className={service.state === 'ready' ? '' : 'text-amber-900'}><strong>{name}: {service.state}</strong>{service.state !== 'ready' ? ` — ${service.detail}` : ''}</p>)}</div> : null}
    <details className="mt-2 text-xs"><summary className="cursor-pointer">Local diagnostics</summary><p className="mt-1">Build: {health.build} · Free memory: {health.resources.freeMiB} MiB · {health.resources.busy ? "Heavy-work slot reserved" : "Heavy-work slot idle"}</p><p>{health.worker.heartbeatAt ? `Last worker update: ${health.worker.heartbeatAt}` : "No worker heartbeat recorded"}</p><p>Worker connectivity does not certify renderer availability or video quality.</p></details>
    <WritingProviderSettings />
  </section>;
}
