import { getHealth } from '@nutrimed/domain';

export default function Home() {
  const { app, status } = getHealth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold">{app.name}</h1>
      <p className="text-sm text-gray-500">
        Esqueleto do monorepo — status: {status} (v{app.version})
      </p>
    </main>
  );
}
