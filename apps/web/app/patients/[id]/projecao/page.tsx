import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import {
  loadPatient,
  listBodyComposition,
  loadCurrentBodyGoal,
  loadPatientPhoto,
  listBodyProjections,
} from '@nutrimed/patients';
import { BodyProjectionPanel } from '@/components/dashboard/body-projection-panel';
import { BodyProjectionList } from '@/components/dashboard/body-projection-list';

/**
 * Projeção corporal por foto. Página própria como a importação de laudo: o
 * fluxo é upload → geração → decisão do médico, e não cabe numa aba de leitura.
 * Só o que for aprovado aqui chega ao paciente no Modo Apresentação.
 */
export default async function ProjecaoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const db = await getDb();
  const key = getEncryptionKey();
  const patient = await loadPatient(db, id, key);
  if (!patient || patient.userId !== user.id) notFound();

  const body = await listBodyComposition(db, id, key);
  const goal = await loadCurrentBodyGoal(db, id, key);
  const photo = await loadPatientPhoto(db, id, key);
  const projections = await listBodyProjections(db, id, key);

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-8">
      <header className="border-b border-ink/10 pb-5">
        <Link
          href={`/patients/${id}/dashboard`}
          className="text-sm text-ink-muted transition-colors hover:text-ink"
        >
          ← Dashboard
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Projeção corporal
        </h1>
        <p className="text-sm text-ink-muted">
          {patient.name} — a IA projeta a silhueta no peso desejado a partir de uma foto.
        </p>
      </header>

      <div className="mt-6 rounded-[10px] border border-amber-300/50 bg-amber-400/10 p-4 text-sm text-amber-800">
        <strong>Imagem ilustrativa gerada por IA.</strong> Não é previsão médica nem estimativa de
        composição corporal: é apoio visual para a conversa sobre a meta. O resultado real depende
        de fatores individuais. Nada é mostrado ao paciente sem a sua aprovação.
      </div>

      <section className="mt-6">
        <BodyProjectionPanel
          patientId={id}
          pesoAtual={body.at(-1)?.values.peso}
          pesoMeta={goal?.values.peso}
        />
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">Projeções salvas</h2>
        <BodyProjectionList patientId={id} photo={photo} projections={projections} />
      </section>
    </main>
  );
}
