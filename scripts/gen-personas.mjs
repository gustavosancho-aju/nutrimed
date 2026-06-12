/**
 * Gera os retratos das 3 personas do board via Gemini (imagem) — identidade
 * visual: cada especialista sentado à mesa do seu consultório.
 * Uso: node --env-file=.env scripts/gen-personas.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error('GEMINI_API_KEY ausente no .env');

const STYLE =
  'Fotografia editorial fotorrealista, retrato profissional médico, sentado à mesa de um consultório moderno e acolhedor, ' +
  'olhando para a câmera com expressão confiante e acolhedora, jaleco branco impecável, ' +
  'iluminação natural suave vinda de janela lateral, fundo de consultório levemente desfocado (estante com livros médicos, planta), ' +
  'detalhes em verde-petróleo (cadeira ou objeto na mesa) como acento de marca, ' +
  'enquadramento da cintura para cima, proporção quadrada 1:1, qualidade de revista médica premium. ' +
  'Sem texto, sem logotipos, sem marca d\'água.';

const PERSONAS = [
  {
    id: 'aurelio',
    prompt:
      `Médico brasileiro de 68 anos, nutrólogo sênior, cabelos grisalhos bem cuidados, ` +
      `rosto sereno e sábio de mentor que ensina por histórias, leve sorriso acolhedor, ` +
      `óculos de armação fina, postura calma de quem conduz o caso. Sobre a mesa: bloco de anotações e caneta. ${STYLE}`,
  },
  {
    id: 'paulo',
    prompt:
      `Médico brasileiro de 57 anos, cardiologista preventivista, aparência atlética e enérgica, ` +
      `cabelo curto grisalho nas têmporas, sorriso firme e motivador de quem destrava em vez de travar, ` +
      `estetoscópio vermelho-escuro no pescoço. Sobre a mesa: um modelo anatômico de coração. ${STYLE}`,
  },
  {
    id: 'yara',
    prompt:
      `Médica brasileira nikkei (descendência japonesa) de 55 anos, endocrinologista, ` +
      `cabelo preto liso na altura dos ombros com mechas grisalhas elegantes, olhar curioso e investigativo ` +
      `de quem conecta pontos que outros não veem, expressão inteligente e gentil. ` +
      `Sobre a mesa: exames de laboratório e um tablet. ${STYLE}`,
  },
];

const MODEL = 'gemini-2.5-flash-image';
mkdirSync('apps/web/public/personas', { recursive: true });

for (const persona of PERSONAS) {
  process.stdout.write(`Gerando ${persona.id}… `);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: persona.prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) {
    console.error(`FALHOU (${res.status}):`, JSON.stringify(data.error ?? data).slice(0, 300));
    process.exitCode = 1;
    continue;
  }
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) {
    console.error('sem imagem na resposta:', JSON.stringify(data).slice(0, 300));
    process.exitCode = 1;
    continue;
  }
  const buffer = Buffer.from(part.inlineData.data, 'base64');
  writeFileSync(`apps/web/public/personas/${persona.id}.png`, buffer);
  console.log(`OK (${Math.round(buffer.length / 1024)} KB)`);
}
