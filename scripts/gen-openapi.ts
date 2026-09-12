import { swaggerSpec } from '../src/config/swagger';
import fs from 'fs';

const outPath = process.argv[2] || './openapi.json';
fs.writeFileSync(outPath, JSON.stringify(swaggerSpec, null, 2));
// eslint-disable-next-line no-console
console.log(`Wrote ${outPath} (${Object.keys((swaggerSpec as any).paths).length} paths)`);
