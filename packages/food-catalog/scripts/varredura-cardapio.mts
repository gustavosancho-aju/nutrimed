import { resolveFood } from '../src/resolve';

// Cardápio brasileiro comum — o que um paciente de nutrologia digita de fato.
const TERMOS = [
  'arroz', 'arroz integral', 'feijao', 'feijao preto', 'macarrao', 'macarrao integral', 'espaguete',
  'lasanha', 'nhoque', 'pizza', 'pao frances', 'pao integral', 'pao de queijo', 'tapioca', 'cuscuz',
  'aveia', 'granola', 'cereal matinal', 'torrada', 'biscoito', 'bolacha', 'bolo',
  'frango', 'frango grelhado', 'peito de frango', 'coxa de frango', 'carne', 'carne moida', 'bife',
  'picanha', 'alcatra', 'patinho', 'costela', 'linguica', 'bacon', 'presunto', 'salsicha',
  'hamburguer', 'peixe', 'tilapia', 'salmao', 'atum', 'sardinha', 'camarao', 'merluza',
  'ovo', 'ovo cozido', 'ovo frito', 'clara de ovo', 'omelete',
  'leite', 'leite desnatado', 'leite integral', 'iogurte', 'iogurte natural', 'iogurte grego',
  'queijo', 'queijo minas', 'mussarela', 'requeijao', 'manteiga', 'margarina', 'creme de leite',
  'batata', 'batata doce', 'batata frita', 'mandioca', 'inhame', 'abobora', 'cenoura', 'beterraba',
  'brocolis', 'couve', 'alface', 'tomate', 'pepino', 'cebola', 'alho', 'pimentao', 'repolho',
  'vagem', 'ervilha', 'milho', 'quiabo', 'berinjela', 'abobrinha', 'chuchu', 'espinafre', 'rucula',
  'banana', 'maca', 'laranja', 'mamao', 'melancia', 'melao', 'uva', 'manga', 'abacaxi', 'pera',
  'morango', 'goiaba', 'abacate', 'kiwi', 'limao', 'tangerina', 'ameixa', 'coco',
  'whey', 'whey isolado', 'creatina', 'albumina', 'barra de proteina', 'pasta de amendoim',
  'amendoim', 'castanha', 'castanha de caju', 'nozes', 'amendoas', 'chia', 'linhaca', 'granola',
  'azeite', 'oleo', 'acucar', 'mel', 'chocolate', 'sorvete', 'refrigerante', 'suco de laranja',
  'cafe', 'cha', 'agua', 'cerveja', 'vinho', 'lentilha', 'grao de bico', 'soja', 'tofu', 'quinoa',
  'salada', 'sopa', 'farofa', 'strogonoff', 'feijoada', 'panqueca', 'crepioca', 'acai',
];

const ok: string[] = [];
const incerto: string[] = [];
const falha: string[] = [];

for (const t of TERMOS) {
  const r = resolveFood(t);
  if (!r.ok) {
    falha.push(`${t}  [${r.miss.reason}]`);
  } else if (r.food.via === 'busca' && !r.food.confident) {
    incerto.push(`${t}  → ${r.food.description} (${r.food.score})`);
  } else if (r.food.via === 'busca') {
    ok.push(`${t}  → ${r.food.description} (busca, ${r.food.score})`);
  }
}

console.log(`\n########## NÃO RESOLVEM (${falha.length}) ##########`);
falha.forEach((l) => console.log('  ' + l));
console.log(`\n########## INCERTOS (${incerto.length}) ##########`);
incerto.forEach((l) => console.log('  ' + l));
console.log(`\n########## RESOLVIDOS PELA BUSCA, confiantes (${ok.length}) ##########`);
ok.forEach((l) => console.log('  ' + l));
console.log(`\ntotal ${TERMOS.length} · catálogo cobre ${TERMOS.length - falha.length - incerto.length - ok.length}`);
