import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InstituteGuard } from '../common/institute.guard';
import { ReportsService } from './reports.service';
import { CurrentUser, AuthUser } from '../common/current-user';

@Controller('reports')
@UseGuards(AuthGuard('jwt'), InstituteGuard)
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('columns')
  columns() {
    return this.reports.columns();
  }

  @Post('files')
  files(
    @CurrentUser() user: AuthUser,
    @Body() body: { columns?: string[]; month?: string; year?: string; session?: string },
  ) {
    return this.reports.fileReport(user, body?.columns, body?.month, body?.year, body?.session);
  }

  @Get('examiner-tracking')
  tracking(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
  ) {
    return this.reports.examinerTracking(user, month, year, session);
  }
}
