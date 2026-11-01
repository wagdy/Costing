// `ng build` that ends when the build does. With this project's Angular 21.2 and esbuild 0.28,
// `ng build` writes its output and then never exits: an esbuild service process stays alive. In a
// Docker build (Railway's), that would hang the deploy for ever. This runs it, passes on all it
// says, and ends it once it has said where its output is (done), or that the build failed. If it
// exits by itself first, its own exit code is this one's.
//
//   node scripts/build.mjs --configuration production --output-path /app-dist
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');
const child = spawn(process.execPath, [ng, 'build', ...process.argv.slice(2)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NG_CLI_ANALYTICS: 'false' },
});

let ending = false;
let failed = false;

function end(code) {
  if (ending) {
    return;
  }
  ending = true;
  // A moment for the last of what it says to come through.
  setTimeout(() => {
    child.kill('SIGTERM');
    process.exit(code);
  }, 1000);
}

function pass(stream, to) {
  stream.on('data', (chunk) => {
    to.write(chunk);
    const text = chunk.toString();
    if (/Application bundle generation failed/.test(text)) {
      failed = true;
      end(1);
    } else if (/Output location:/.test(text)) {
      end(failed ? 1 : 0);
    }
  });
}

pass(child.stdout, process.stdout);
pass(child.stderr, process.stderr);
child.on('exit', (code, signal) => {
  if (!ending) {
    process.exit(code ?? (signal ? 1 : 0));
  }
});
