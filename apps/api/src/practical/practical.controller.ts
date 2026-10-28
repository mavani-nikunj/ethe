import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { practicalUpload, sendUpload } from './practical-files';
import { UserRole } from '@ethesis/shared';
import { InstituteGuard } from '../common/institute.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, AuthUser } from '../common/current-user';
import { PracticalService } from './practical.service';

/**
 * Appointment of Practical Examiner. Read access: Dealing, Authority (Assoc. Dean / ACE), Institute Admin.
 * Writes are further restricted inside the service (Dealing for entry/sending, Assoc. Dean for vetting).
 */
@Controller('practical')
@UseGuards(AuthGuard('jwt'), InstituteGuard, RolesGuard)
@Roles(UserRole.DEALING, UserRole.AUTHORITY, UserRole.INSTITUTE_ADMIN)
export class PracticalController {
  constructor(private practical: PracticalService) {}

  @Get('meta')
  meta(@CurrentUser() user: AuthUser) {
    return this.practical.meta(user);
  }

  @Get('counts')
  counts(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.practical.counts(user, q);
  }

  @Post('sessions')
  ensureSession(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.ensureSession(user, body);
  }

  @Get('lookups')
  lookups(@CurrentUser() user: AuthUser) {
    return this.practical.listLookups(user);
  }

  @Post('lookups')
  addLookup(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.addLookup(user, body);
  }

  @Post('specialities')
  addSpeciality(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.addSpeciality(user, body);
  }

  @Patch('specialities/:id')
  renameSpeciality(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.practical.renameSpeciality(user, id, body);
  }

  @Get('schedule')
  schedule(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.practical.getSchedule(user, q);
  }

  @Put('schedule')
  saveSchedule(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.saveSchedule(user, body);
  }

  @Get('schedule/:id/board')
  board(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.practical.board(user, id);
  }

  @Get('suggestions')
  suggestions(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.practical.suggestions(user, q);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.practical.history(user, q);
  }

  @Post('examiner-details')
  createDetail(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.createDetail(user, body);
  }

  @Get('examiner-details/:id')
  getDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.practical.getDetail(user, id);
  }

  @Patch('examiner-details/:id')
  updateDetail(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.practical.updateDetail(user, id, body);
  }

  @Get('examiners')
  list(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.practical.list(user, q);
  }

  @Post('examiners/send-to-dean')
  sendToDean(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.sendToDean(user, body);
  }

  @Post('examiners/vet')
  vet(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.vet(user, body);
  }

  @Post('examiners/offer')
  sendOffer(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.sendOffer(user, body);
  }

  @Post('examiners/offer/resend')
  resendOffer(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.resendOffer(user, body);
  }

  @Post('examiners/offer/replacement')
  replacementOffer(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.replacementOffer(user, body);
  }

  @Post('examiners/appoint')
  appoint(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.appoint(user, body);
  }

  @Post('examiners/appoint/resend')
  resendAppointment(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.resendAppointment(user, body);
  }

  @Get('mail-templates')
  mailTemplates(@CurrentUser() user: AuthUser) {
    return this.practical.mailTemplates(user);
  }

  @Post('examiners/mail')
  sendTemplateMail(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.sendTemplateMail(user, body);
  }

  @Post('chairperson/date-request')
  dateRequest(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.dateRequest(user, body);
  }

  @Post('chairperson/date-reminder')
  dateReminder(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.dateReminder(user, body);
  }

  @Post('chairperson/date-fixed')
  dateFixed(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.dateFixed(user, body);
  }

  @Post('air/ticket-request')
  ticketRequest(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.ticketRequest(user, body);
  }

  @Post('examiners/:id/air-remarks')
  airRemarks(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.practical.airRemarks(user, id, body);
  }

  @Post('letters/bulk')
  lettersBulk(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.lettersBulk(user, body);
  }

  @Get('documents')
  documents(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.practical.listDocuments(user, q);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', practicalUpload('practical-docs', /\.pdf$/i, 'Upload a PDF file', 20)))
  uploadDocument(@CurrentUser() user: AuthUser, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    return this.practical.uploadDocument(
      user,
      body,
      file ? { path: `practical-docs/${file.filename}`, originalName: file.originalname } : undefined,
    );
  }

  @Delete('documents/:id')
  removeDocument(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.practical.removeDocument(user, id);
  }

  @Get('documents/:id/file')
  async documentFile(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const doc = await this.practical.getDocument(user, id);
    sendUpload(res, doc.path, doc.originalName);
  }

  @Get('signature')
  signature(@CurrentUser() user: AuthUser) {
    return this.practical.signature(user);
  }

  @Post('signature')
  @UseInterceptors(FileInterceptor('file', practicalUpload('signatures', /\.(png|jpe?g)$/i, 'Signature must be a PNG or JPG image', 2)))
  setSignature(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.practical.setSignature(user, file ? { path: `signatures/${file.filename}` } : undefined);
  }

  @Get('examiners/:id/letter/:kind')
  letter(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('kind') kind: string) {
    return this.practical.letter(user, id, kind);
  }

  @Post('examiners/delete')
  removeMany(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.removeMany(user, body);
  }

  @Get('examiners/:id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.practical.getOne(user, id);
  }

  @Post('examiners')
  create(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.practical.create(user, body);
  }

  @Patch('examiners/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.practical.update(user, id, body);
  }

  @Delete('examiners/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.practical.remove(user, id);
  }

  @Post('examiners/:id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.practical.reject(user, id, body);
  }

  @Post('examiners/:id/remarks')
  remarks(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.practical.saveRemarks(user, id, body);
  }
}
