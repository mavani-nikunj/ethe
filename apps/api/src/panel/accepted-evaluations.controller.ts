import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InstituteGuard } from '../common/institute.guard';
import { CurrentUser, AuthUser } from '../common/current-user';
import { AcceptedEvaluationsService } from './accepted-evaluations.service';

type Items = { items?: { fileId: string; panelIndex: number }[] };

@Controller('accepted-evaluations')
@UseGuards(AuthGuard('jwt'), InstituteGuard)
export class AcceptedEvaluationsController {
  constructor(private accepted: AcceptedEvaluationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
    @Query('courseId') courseId?: string,
    @Query('specialityId') specialityId?: string,
    @Query('dealingId') dealingId?: string,
  ) {
    return this.accepted.list(user, { month, year, session, courseId, specialityId, dealingId });
  }

  @Post('print')
  print(@CurrentUser() user: AuthUser, @Body() body: Items) {
    return this.accepted.print(user, body?.items || []);
  }

  @Post('send-mail')
  sendMail(@CurrentUser() user: AuthUser, @Body() body: Items & { templateId?: string }) {
    return this.accepted.sendMail(user, String(body?.templateId || ''), body?.items || []);
  }
}
