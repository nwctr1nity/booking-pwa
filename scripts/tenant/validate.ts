// pnpm tenant:validate <slug> | --all
// Checks business.json against the schema and the images (presence, size,
// dimensions). Exit code 1 on any error. Also refreshes tenants/business.schema.json
// (JSON Schema for editor hints).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parseArgs } from '../lib/args.ts';
import { listTenantSlugs, TENANTS_DIR, validateTenant } from './load.ts';
import { businessSchema } from './schema.ts';

export function writeJsonSchema() {
  const schema = z.toJSONSchema(businessSchema, { io: 'input', unrepresentable: 'any' });
  writeFileSync(path.join(TENANTS_DIR, 'business.schema.json'), JSON.stringify(schema, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { positional, flags } = parseArgs();
  const slugs = flags.all ? listTenantSlugs() : positional;
  if (slugs.length === 0) {
    console.error('usage: pnpm tenant:validate <slug> | --all');
    process.exit(2);
  }
  writeJsonSchema();
  let failed = false;
  for (const slug of slugs) {
    const r = await validateTenant(slug);
    console.log(`${r.ok ? '✓' : '✗'} ${slug}${r.tenant ? ` (hash ${r.tenant.hash})` : ''}`);
    for (const e of r.errors) console.log(`   ошибка: ${e}`);
    for (const w of r.warnings) console.log(`   внимание: ${w}`);
    failed ||= !r.ok;
  }
  process.exit(failed ? 1 : 0);
}
