// ─── CLI: emitir una llave del API v1 ────────────────────────────────────────
//
// Uso (siempre con dotenv para DATABASE_URL + UTOPIA_API_KEY_PEPPER):
//   npm run api:create-key -- --workspace <uuid> --name "ERP Piloto"
//   npm run api:create-key -- --workspace-name "Empresa SAS" --nit 900123456 --name "ERP Piloto" --test
//
// Flags:
//   --workspace <uuid>        workspace existente
//   --workspace-name <str>    crea un workspace nuevo (con --nit opcional)
//   --name <str>              etiqueta de la llave (obligatorio)
//   --scopes a,b              default: todos (trial_balances:read/write, webhooks:manage)
//   --test                    emite utop_sk_test_ (default: live)
//   --expires-days N          default 365; --no-expiry para sin expiración
//
// El token se imprime UNA sola vez. En reposo solo queda su HMAC.

import { getDb } from '@/lib/db/client';
import { isApiKeyPepperConfigured } from '@/lib/api/keys';
import { mintApiKey } from '@/lib/api/key-service';

function readFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  if (!isApiKeyPepperConfigured()) {
    console.error('✖ Falta UTOPIA_API_KEY_PEPPER en el entorno (.env.local).');
    console.error(
      '  Generar: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
    );
    process.exit(1);
  }

  const name = readFlag('name');
  if (!name) {
    console.error('✖ Falta --name "<etiqueta de la llave>".');
    process.exit(1);
  }

  const workspaceId = readFlag('workspace');
  const workspaceName = readFlag('workspace-name');
  if (!workspaceId && !workspaceName) {
    console.error('✖ Falta --workspace <uuid> o --workspace-name "<nombre>".');
    process.exit(1);
  }

  const scopesFlag = readFlag('scopes');
  const minted = await mintApiKey(getDb(), {
    workspaceId,
    workspace: workspaceName
      ? { name: workspaceName, nit: readFlag('nit') }
      : undefined,
    name,
    scopes: scopesFlag ? scopesFlag.split(',').map((s) => s.trim()) : undefined,
    mode: hasFlag('test') ? 'test' : 'live',
    expiresDays: hasFlag('no-expiry')
      ? null
      : readFlag('expires-days')
        ? Number(readFlag('expires-days'))
        : undefined,
    createdBy: 'cli',
  });

  console.log('\n✔ Llave emitida\n');
  console.log(`  id:           ${minted.id}`);
  console.log(`  workspace_id: ${minted.workspaceId}`);
  console.log(`  scopes:       ${minted.scopes.join(', ')}`);
  console.log(`  expira:       ${minted.expiresAt ?? 'nunca'}`);
  console.log('\n  TOKEN (única vez — guárdelo en un vault):\n');
  console.log(`    ${minted.token}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('✖ Falló la emisión:', err);
  process.exit(1);
});
