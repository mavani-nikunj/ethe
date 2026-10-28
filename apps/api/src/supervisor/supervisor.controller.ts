import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@ethesis/shared';
import { InstituteGuard } from '../common/institute.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, AuthUser } from '../common/current-user';
import { practicalUpload, removeUpload } from '../practical/practical-files';
import { SupervisorService } from './supervisor.service';
import { CHEQUE_FOLDER, CHEQUE_PATTERN, readCheque } from './supervisor-files';

/**
 * Supervisor menu (theory exam supervisory duty). Read access: Dealing, Authority (ACE / Assoc. Dean),
 * Institute Admin. Dealing writes; only the ACE approves (checked in the service).
 */
@Controller('supervisor')
@UseGuards(AuthGuard('jwt'), InstituteGuard, RolesGuard)
@Roles(UserRole.DEALING, UserRole.AUTHORITY, UserRole.INSTITUTE_ADMIN)
export class SupervisorController {
  constructor(private svc: SupervisorService) {}

  @Get('meta')
  meta(@CurrentUser() user: AuthUser) {
    return this.svc.meta(user);
  }

  @Get('counts')
  counts(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.counts(user, q);
  }

  @Post('lookups')
  addLookup(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.addLookup(user, body);
  }

  // ----- sessions

  @Get('sessions/current')
  current(@CurrentUser() user: AuthUser) {
    return this.svc.currentSession(user);
  }

  @Post('sessions')
  createSession(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.createSession(user, body);
  }

  @Patch('sessions/:id')
  updateSession(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateSession(user, id, body);
  }

  @Post('sessions/:id/activate')
  activate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.activateSession(user, id);
  }

  // ----- schedule

  @Get('schedule')
  schedule(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.listSchedule(user, q);
  }

  @Get('schedule/prefill')
  prefill(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.prefill(user, q);
  }

  @Post('schedule')
  createSchedule(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.createSchedule(user, body);
  }

  @Patch('schedule/:id')
  updateSchedule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateSchedule(user, id, body);
  }

  @Delete('schedule/:id')
  deleteSchedule(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteSchedule(user, id);
  }

  // ----- people (Edit All Supervisor)

  @Get('people')
  people(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.listPeople(user, q);
  }

  @Patch('people/:id')
  updatePerson(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.svc.updatePerson(user, id, body);
  }

  @Post('people/delete')
  deletePeople(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.deletePeople(user, body);
  }

  // ----- appointments and workflow

  @Get('appointments')
  list(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.listAppointments(user, q);
  }

  @Post('appointments')
  create(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.createAppointment(user, body);
  }

  @Post('appointments/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.withdraw(user, body);
  }

  @Post('appointments/send-to-ace')
  sendToAce(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.sendToAce(user, body);
  }

  @Post('appointments/approve')
  approve(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.approve(user, body);
  }

  @Post('appointments/send-offer')
  sendOffer(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.sendOffer(user, body);
  }

  @Post('appointments/resend-offer')
  resendOffer(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.resendOffer(user, body);
  }

  @Post('letters')
  letters(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.letters(user, body);
  }

  @Get('day-wise')
  dayWise(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.dayWise(user, q);
  }

  @Get('appointments/:id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getAppointment(user, id);
  }

  @Patch('appointments/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateAppointment(user, id, body);
  }

  @Post('appointments/:id/duties')
  addDuty(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.svc.addDuty(user, id, body);
  }

  @Delete('appointments/:id/duties/:scheduleId')
  removeDuty(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('scheduleId') scheduleId: string) {
    return this.svc.removeDuty(user, id, scheduleId);
  }

  @Patch('appointments/:id/acceptance')
  @UseInterceptors(FileInterceptor('cheque', practicalUpload(CHEQUE_FOLDER, CHEQUE_PATTERN, 'Cancelled cheque must be a JPG, PNG or PDF file')))
  async updateAcceptance(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() cheque?: Express.Multer.File,
  ) {
    const path = cheque ? `${CHEQUE_FOLDER}/${cheque.filename}` : undefined;
    try {
      return await this.svc.updateAcceptance(user, id, body, path);
    } catch (err) {
      await removeUpload(path);
      throw err;
    }
  }

  /** Cancelled cheque as a data URL (the file is kept outside the public uploads). */
  @Get('appointments/:id/cheque')
  async cheque(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const c = await this.svc.chequeOf(user, id);
    return readCheque(c.path, c.name);
  }
}
