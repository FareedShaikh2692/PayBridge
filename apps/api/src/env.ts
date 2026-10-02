import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads a local .env for development. In deployed environments variables come from the platform. */
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}
