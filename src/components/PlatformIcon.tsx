type Platform = "instagram" | "facebook" | "youtube" | "rumble" | "bilibili";

export default function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="none">
    {platform === "instagram" && <><rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" /></>}
    {platform === "facebook" && <path fill="currentColor" d="M14 22v-9h3l.5-3H14V8c0-1 .4-2 2-2h2V3.3C17.5 3.1 16.5 3 15.4 3 12 3 10 5 10 8v2H7v3h3v9h4Z" />}
    {platform === "youtube" && <path fill="currentColor" fillRule="evenodd" d="M3.4 6.2C4.2 5 7 5 12 5s7.8 0 8.6 1.2C21.5 7.2 22 9 22 12s-.5 4.8-1.4 5.8C19.8 19 17 19 12 19s-7.8 0-8.6-1.2C2.5 16.8 2 15 2 12s.5-4.8 1.4-5.8ZM10 8.5v7l6-3.5-6-3.5Z" />}
    {platform === "rumble" && <path d="m6 5 14 7-14 7V5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />}
    {platform === "bilibili" && <path d="m8 3 4 4 4-4M4 10a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7Zm5 3v2m6-2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>;
}
