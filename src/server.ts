import { buildApp } from './app.js';
import { env } from './config/env.js';

async function start() {
  try {
    const app = await buildApp();

    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    console.log(`\n🥚 EggDrop Backend running at http://${env.HOST}:${env.PORT}`);
    console.log(`🩺 Health check: http://${env.HOST}:${env.PORT}/api/health\n`);
  } catch (err) {
    console.error('Fatal error during startup:', err);
    process.exit(1);
  }
}

start();
