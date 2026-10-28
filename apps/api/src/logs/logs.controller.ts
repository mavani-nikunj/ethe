import { Body, Controller, Get, Headers, Ip, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { PlatformOnlyGuard } from '../common/platform.guard';
import { CurrentUser, AuthUser } from '../common/current-user';
import { LogsService } from './logs.service';

/** Browsers report errors the user saw. Public (task links have no login); rate limited; writes the log file only. */
@Controller('client-logs')
export class ClientLogsController {
  constructor(private logs: LogsService) {}

  @Post()
  report(@Body() body: any, @Req() req: any, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return this.logs.recordClient(body || {}, fwd || ip || '-', ua);
  }
}

/** Error log files: Super Admin only. */
@Controller('platform/logs')
@UseGuards(AuthGuard('jwt'), PlatformOnlyGuard)
export class PlatformLogsController {
  constructor(private logs: LogsService) {}

  @Get()
  days() {
    return this.logs.days();
  }

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query('ref') ref: string) {
    return this.logs.findRef(user, ref);
  }

  @Get(':date')
  day(
    @CurrentUser() user: AuthUser,
    @Param('date') date: string,
    @Query('level') level?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logs.day(user, date, { level, q, status, limit });
  }

  @Get(':date/download')
  async download(@CurrentUser() user: AuthUser, @Param('date') date: string, @Res() res: Response) {
    const abs = await this.logs.downloadPath(user, date);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ethesis-logs-${date}.txt"`);
    res.sendFile(abs);
  }
}
