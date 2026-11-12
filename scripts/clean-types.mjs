// vue-tsc also writes declarations for the component and the internal files it imports.
// The package's public types are only index.d.ts and types/, so the rest is removed.
import fs from 'node:fs';

for (const dir of ['components', 'utils']) {
  fs.rmSync(`dist/types/${dir}`, { recursive: true, force: true });
}
