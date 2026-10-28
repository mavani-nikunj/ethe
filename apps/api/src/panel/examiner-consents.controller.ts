import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InstituteGuard } from '../common/institute.guard';
import { CurrentUser, AuthUser } from '../common/current-user';
import { ExaminerConsentsService } from './examiner-consents.service';

@Controller('examiner-consents')
@UseGuards(AuthGuard('jwt'), InstituteGuard)
export class ExaminerConsentsController {
  constructor(private consents: ExaminerConsentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
    @Query('q') q?: string,
  ) {
    return this.consents.list(user, month, year, session, q);
  }

  @Post('send-offer')
  sendOffer(
    @CurrentUser() user: AuthUser,
    @Body() body: { items?: { fileId: string; panelIndex: number }[]; resend?: boolean },
  ) {
    return this.consents.sendOffer(user, body?.items || [], !!body?.resend);
  }

  @Post('send-thesis')
  sendThesis(
    @CurrentUser() user: AuthUser,
    @Body() body: { items?: { fileId: string; panelIndex: number }[]; resend?: boolean },
  ) {
    return this.consents.sendThesis(user, body?.items || [], !!body?.resend);
  }
}
