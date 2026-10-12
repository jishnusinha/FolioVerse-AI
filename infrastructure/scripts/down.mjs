#!/usr/bin/env node
/** Stops the stack. Data volumes are kept unless `--volumes` is passed explicitly. */
import { run } from './lib.mjs';

const withVolumes = process.argv.includes('--volumes');
if (withVolumes) console.log('down: removing containers AND data volumes (local data will be lost)');
await run('docker', ['compose', '--profile', 'app', '--profile', 'observability', '--profile', 'local-llm', 'down', ...(withVolumes ? ['-v'] : [])]);
