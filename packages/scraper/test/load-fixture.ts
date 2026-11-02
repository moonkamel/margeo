import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));
export const item = (name: string): unknown => fixture(`items/${name}.json`);
