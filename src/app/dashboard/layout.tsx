export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div data-studio-theme="night" className="min-h-screen bg-background text-foreground">{children}</div>;
}
