// 本地联调用：周期性驱动评估 worker（产品代码仅暴露 pollOnce，无内置常驻循环）。
// 运行：node --env-file=../api/.env .dev-run.mjs
import { bootstrapWorker } from './dist/main.js';

const worker = await bootstrapWorker();
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const result = await worker.pollOnce();
    if ((result.scanned ?? 0) > 0 || (result.dispatched ?? 0) > 0) {
      console.log(new Date().toISOString(), 'worker poll', JSON.stringify(result));
    }
  } catch (error) {
    console.error(new Date().toISOString(), 'worker poll error:', error?.message ?? error);
  } finally {
    busy = false;
  }
}
await tick();
setInterval(tick, 3000);
console.log('evaluation worker dev loop started (interval 3s, Ctrl+C to stop)');
async function shutdown() {
  try { await worker.close?.(); } finally { process.exit(0); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
