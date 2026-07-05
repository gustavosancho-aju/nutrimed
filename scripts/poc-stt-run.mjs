// Ciclo da POC 2.5 (Transcrição Confiável, Story 3) com áudio TTS.
// Gera fala pt-BR sintética (Gemini TTS) de frases clínicas com referência conhecida,
// transcreve por cada configuração do Deepgram (nova-2+keywords vs nova-3+keyterm) e
// pontua por recall de termo clínico + WER (métricas de @nutrimed/domain).
//
//   node --env-file=.env --experimental-strip-types scripts/poc-stt-run.mjs
//
// ⚠️ Faz chamadas REAIS e cobradas (Gemini TTS + Deepgram STT). Áudio TTS é mais LIMPO
// que consulta real → números OTIMISTAS (teto). É o 1º ciclo/sinal direcional; o áudio
// real confirma sob ruído/sotaque/fala sobreposta.
import { CLINICAL_VOCABULARY } from '../packages/domain/src/clinical-vocabulary.ts';
import { scoreTranscript } from '../packages/domain/src/stt-accuracy.ts';

const GEMINI = process.env.GEMINI_API_KEY;
const DEEPGRAM = process.env.DEEPGRAM_API_KEY;
if (!GEMINI || !DEEPGRAM) { console.error('faltam GEMINI_API_KEY/DEEPGRAM_API_KEY'); process.exit(1); }

// Referências (o que foi "dito") — ricas nos termos que o STT costuma corromper.
const SENTENCES = [
  'Bom dia. O senhor relata dor precordial aos esforços e palpitação à noite.',
  'Vamos iniciar semaglutida semanal e monitorar a pressão arterial.',
  'Os exames mostram TSH elevado, sugerindo hipotireoidismo.',
  'A hemoglobina glicada veio em sete por cento, com resistência insulínica.',
  'No café da manhã, pão francês com manteiga e uma tapioca.',
  'No almoço, quatro colheres de arroz, feijão carioca e um bife grelhado.',
  'A bioimpedância mostra aumento de massa gorda e queda de massa magra.',
  'Refere dispneia e edema nos membros inferiores no fim do dia.',
  'O colesterol LDL está alto e os triglicerídeos elevados, com dislipidemia.',
  'Suplementa creatina e whey protein após o treino, além de ômega três.',
  'Houve platô no peso apesar do déficit calórico e do jejum intermitente.',
  'Solicitei ferritina, vitamina D e cortisol para investigar o cansaço.',
];

const CONFIGS = [
  { label: 'nova-2 + keywords', model: 'nova-2', boost: 'keywords' },
  { label: 'nova-3 + keyterm', model: 'nova-3', boost: 'keyterm' },
];

async function tts(text) {
  const model = 'gemini-2.5-flash-preview-tts';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Leia em português do Brasil, em tom de consulta: ${text}` }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const part = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!part) throw new Error('TTS sem áudio');
  const rate = Number((part.mimeType.match(/rate=(\d+)/) || [])[1] || 24000);
  return { pcm: Buffer.from(part.data, 'base64'), rate };
}

async function stt(pcm, rate, cfg) {
  const boost = CLINICAL_VOCABULARY.map((t) => `${cfg.boost}=${encodeURIComponent(t)}`).join('&');
  const url = `https://api.deepgram.com/v1/listen?model=${cfg.model}&language=pt-BR&smart_format=true&encoding=linear16&sample_rate=${rate}&channels=1&${boost}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Token ${DEEPGRAM}`, 'Content-Type': 'application/octet-stream' }, body: pcm });
  if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json())?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
}

const agg = new Map(CONFIGS.map((c) => [c.label, { found: 0, expected: 0, wer: 0, n: 0, missed: new Map() }]));

for (let i = 0; i < SENTENCES.length; i++) {
  const ref = SENTENCES[i];
  process.stdout.write(`\n[${i + 1}/${SENTENCES.length}] ${ref}\n`);
  let audio;
  try { audio = await tts(ref); } catch (e) { console.log('  TTS falhou:', e.message); continue; }
  for (const cfg of CONFIGS) {
    try {
      const hyp = await stt(audio.pcm, audio.rate, cfg);
      const s = scoreTranscript(ref, hyp, CLINICAL_VOCABULARY);
      const a = agg.get(cfg.label);
      a.found += s.termRecall.found; a.expected += s.termRecall.expected; a.wer += s.wer; a.n += 1;
      for (const m of s.termRecall.missed) a.missed.set(m, (a.missed.get(m) ?? 0) + 1);
      const flag = s.termRecall.missed.length ? ` ⚠ perdeu: ${s.termRecall.missed.join(', ')}` : ' ✓';
      console.log(`  ${cfg.label.padEnd(18)} recall ${(s.termRecall.recall * 100).toFixed(0)}% WER ${(s.wer * 100).toFixed(0)}%${flag}`);
      if (hyp !== ref) console.log(`      → "${hyp}"`);
    } catch (e) { console.log(`  ${cfg.label}: ${e.message}`); }
  }
}

console.log(`\n${'='.repeat(60)}\nRESULTADO — ${SENTENCES.length} frases · ${CLINICAL_VOCABULARY.length} termos no vocabulário\n`);
for (const [label, a] of agg) {
  const recall = a.expected === 0 ? 1 : a.found / a.expected;
  console.log(`▸ ${label}`);
  console.log(`   recall clínico: ${(recall * 100).toFixed(1)}%  (${a.found}/${a.expected} termos)  ·  WER médio ${((a.wer / Math.max(a.n, 1)) * 100).toFixed(1)}%`);
  const missed = [...a.missed.entries()].sort((x, y) => y[1] - x[1]);
  if (missed.length) console.log(`   termos perdidos: ${missed.map(([t, c]) => `${t}×${c}`).join(', ')}`);
}
console.log('\n⚠ Áudio TTS = teto otimista. Decisão final exige áudio clínico real (ruído/sotaque).');
