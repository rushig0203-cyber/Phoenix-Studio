import type { ReactNode } from "react";

export default function PublicInfoPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="mx-auto w-full max-w-3xl px-6 py-8 sm:py-12">
    <header>
      <a href="/about" className="text-sm font-semibold tracking-tight">Phoenix Studio</a>
      <nav aria-label="Public information" className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
        <a href="/about" className="underline-offset-4 hover:underline">About</a>
        <a href="/privacy" className="underline-offset-4 hover:underline">Privacy</a>
        <a href="/terms" className="underline-offset-4 hover:underline">Terms</a>
        <a href="https://github.com/rushig0203-cyber/Phoenix-Studio/issues" className="underline-offset-4 hover:underline">Contact</a>
      </nav>
      <h1 className="mt-12 text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-5 text-base leading-7 text-muted-foreground">{description}</p>
    </header>
    <article className="mt-10 space-y-9 text-sm leading-7 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:mt-3 [&_a]:underline [&_a]:underline-offset-4">
      {children}
    </article>
    <footer className="mt-12 border-t pt-6 text-sm leading-6 text-muted-foreground">
      <p>Public information for a personal, owner-operated Windows video app.</p>
      <p className="mt-2"><a href="/privacy" className="underline underline-offset-4">Privacy policy</a> · <a href="/terms" className="underline underline-offset-4">Terms of use</a> · <a href="https://github.com/rushig0203-cyber/Phoenix-Studio/issues" className="underline underline-offset-4">Public issue tracker</a></p>
    </footer>
  </main>;
}
