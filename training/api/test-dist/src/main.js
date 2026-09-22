import { NestFactory } from '@nestjs/core';
import process from 'node:process';
import { AppModule } from './app.module.js';
export const apiStartupConfig = Object.freeze({ service: 'api', port: 3000 });
export async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    if (process.env.GONGZHUGOU_GATEWAY_MODE === 'true')
        app.setGlobalPrefix('v1');
    await app.listen(process.env.PORT ?? apiStartupConfig.port);
}
const isEntrypoint = process.argv[1] !== undefined && import.meta.filename === process.argv[1];
if (isEntrypoint) {
    void bootstrap();
}
