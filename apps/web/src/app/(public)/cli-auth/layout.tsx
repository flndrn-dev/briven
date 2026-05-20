export default function CliAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
      {children}
    </main>
  );
}
