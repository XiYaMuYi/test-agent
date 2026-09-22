var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import process from 'node:process';
import { Pool } from 'pg';
import { IdentityModule } from '../identity/identity.module.js';
import { LearnerController } from './learner.controller.js';
import { LearnerService } from './learner.service.js';
const databasePoolProvider = {
    provide: Pool,
    useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }),
};
let LearnerModule = class LearnerModule {
};
LearnerModule = __decorate([
    Module({
        imports: [IdentityModule],
        controllers: [LearnerController],
        providers: [
            databasePoolProvider,
            {
                provide: LearnerService,
                useFactory: (database) => new LearnerService(database),
                inject: [Pool],
            },
        ],
        exports: [LearnerService],
    })
], LearnerModule);
export { LearnerModule };
