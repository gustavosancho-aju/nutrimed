# Backup & Disaster Recovery — NutriMed

> Estado: 2026-07-12. Banco de produção = **Neon Postgres** (região `sa-east-1`).
> App em **Fly.io** (GRU). Dados clínicos cifrados no app (AES-256-GCM) antes de
> chegarem ao banco.

## 1. Modelo de recuperação (o que nos protege)

| Camada | Mecanismo | RPO (perda máx.) | RTO (tempo p/ voltar) | Responsável |
|---|---|---|---|---|
| **Primário** | **Neon PITR** (point-in-time restore, gerenciado) | segundos–minutos (depende do plano) | minutos (restore de branch) | Neon |
| Secundário (opcional) | `pg_dump` offsite via `scripts/db-backup.mjs` | = frequência que você rodar | minutos (`pg_restore`) | você |
| Código/config | Git (main) + `fly.toml` + secrets no Fly | — | 1 deploy | você |
| **Chave de cifra** | `DATA_ENCRYPTION_KEY` guardada SEPARADA | — | — | você |

**Regra de ouro:** o dump/backup do banco contém os dados **cifrados**. Ele só é
útil com a `DATA_ENCRYPTION_KEY` — e essa chave **NÃO pode** viver junto do dump.
Guarde a chave num cofre separado (gerenciador de senhas/secret manager). Sem a
chave, o backup é indecifrável; com as duas juntas num lugar só, um vazamento
expõe tudo. Mantenha-as separadas.

## 2. O que você PRECISA confirmar no Neon (ação sua — não tenho acesso)

1. **Painel Neon → projeto `nutrimed` → Settings → Storage/History retention.**
   Confirme a janela de retenção do PITR (no plano Free costuma ser ~24h; planos
   pagos vão a 7–30 dias). Para dado de saúde, **mínimo recomendado: 7 dias.**
2. Se a janela for curta (24h), **rode o backup offsite** (seção 4) ao menos
   semanalmente — ou suba o plano do Neon para uma janela maior.
3. Anote onde está a `DATA_ENCRYPTION_KEY` de produção (hoje em `fly secrets`) e
   garanta uma **cópia offline** dela num cofre — se perder a chave, todos os
   dados cifrados ficam irrecuperáveis mesmo com o banco intacto.

## 3. Restauração (PITR do Neon)

1. Neon → projeto → **Restore / Branch** → escolha o ponto no tempo (antes do
   incidente).
2. Neon cria um branch/endpoint com o estado daquele instante. Pegue a nova
   connection string.
3. `flyctl secrets set DATABASE_URL="<nova-connection-string>" -a nutrimed`
   (reinicia o app apontando para o estado restaurado) **ou** promova o branch a
   primário no Neon, conforme o caso.
4. Valide: login do médico + um paciente com medições abrindo normalmente.
5. Confirme que a `DATA_ENCRYPTION_KEY` é a MESMA de quando os dados foram
   cifrados — restore com chave diferente ⇒ `decryptField` falha (a nota, a
   ficha etc. dão erro). É por isso que a chave é versionada com cuidado.

## 4. Backup offsite manual (secundário)

Pré-requisito: `pg_dump` no PATH (PostgreSQL client tools).

```powershell
# pegue a connection string de produção (ou do painel Neon)
flyctl ssh console -a nutrimed -C "printenv DATABASE_URL"
# rode o dump (vai para ./backups, que é gitignored)
$env:DATABASE_URL="postgres://..."; node scripts/db-backup.mjs
```

Restaurar um dump em um banco vazio:

```powershell
pg_restore --no-owner --no-privileges -d "postgres://destino..." backups/nutrimed-YYYYMMDD-HHmmss.dump
```

Guarde os `.dump` **fora** do repositório e do servidor (drive pessoal cifrado /
bucket privado). Nunca comite — `backups/` está no `.gitignore`.

## 5. Pendências para "DR confirmado"

- [ ] Confirmar a janela de retenção do PITR no Neon (≥ 7 dias) — **você**.
- [ ] Cópia offline da `DATA_ENCRYPTION_KEY` num cofre separado — **você**.
- [ ] Fazer 1 teste de restauração de ponta a ponta (restore → validar login) e
      anotar o RTO real — **você** (com o app parado num horário combinado).
- [ ] (Opcional) Agendar `scripts/db-backup.mjs` (Task Scheduler/cron) se a
      janela do Neon for curta.
