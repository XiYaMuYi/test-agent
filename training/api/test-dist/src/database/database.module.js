var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DatabaseModule_1;
import { Module } from '@nestjs/common';
import process from 'node:process';
export const DATABASE_CONFIGURATION = Symbol('DATABASE_CONFIGURATION');
/** Reads only local configuration; opening connections remains an explicit runtime operation. */
export function readDatabaseConfiguration(environment = process.env) {
    const connectionString = environment.DATABASE_URL?.trim();
    if (connectionString === undefined || connectionString.length === 0) {
        throw new Error('DATABASE_URL is required for database commands.');
    }
    return { connectionString };
}
let DatabaseModule = DatabaseModule_1 = class DatabaseModule {
    static forRoot(configuration) {
        return {
            module: DatabaseModule_1,
            providers: [{ provide: DATABASE_CONFIGURATION, useValue: configuration }],
            exports: [DATABASE_CONFIGURATION],
        };
    }
};
DatabaseModule = DatabaseModule_1 = __decorate([
    Module({})
], DatabaseModule);
export { DatabaseModule };
