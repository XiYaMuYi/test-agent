import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { ScenarioService } from './scenario.service.js';

@Controller('admin/release-snapshots')
@UseGuards(PrincipalGuard, RbacGuard)
@Roles('admin')
export class ReleaseSnapshotController {
  public constructor(private readonly scenarios: ScenarioService) {}

  @Get()
  async list(
    @Principal() principal: CurrentPrincipal,
    @Query('scenarioDraftId') scenarioDraftId?: string,
  ): Promise<{ items: readonly unknown[] }> {
    const items = await this.scenarios.listSnapshots(principal, scenarioDraftId);
    return { items };
  }
}
