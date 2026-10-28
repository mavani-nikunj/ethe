import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InstituteGuard } from '../common/institute.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@ethesis/shared';
import { CommsService } from './comms.service';
import { CurrentUser, AuthUser } from '../common/current-user';

const Writers = [UserRole.DEALING] as const;

@Controller('comms')
@UseGuards(AuthGuard('jwt'), InstituteGuard)
export class CommsController {
  constructor(private comms: CommsService) {}

  @Get('placeholders')
  placeholders() {
    return this.comms.placeholders();
  }

  @Get('catalog')
  catalog(@Query('channel') channel?: string) {
    return this.comms.catalog(channel);
  }

  @Get('templates')
  templates(@CurrentUser() user: AuthUser, @Query('channel') channel?: string) {
    return this.comms.listTemplates(user, channel);
  }

  @Post('templates')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  createTpl(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.comms.createTemplate(user, body);
  }

  @Patch('templates/:id')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  updateTpl(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.comms.updateTemplate(user, id, body);
  }

  @Delete('templates/:id')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  removeTpl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comms.removeTemplate(user, id);
  }

  @Post('seed-defaults')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  seed(@CurrentUser() user: AuthUser, @Query('channel') channel?: string) {
    return this.comms.seedDefaults(user, channel);
  }

  @Get('reminders')
  reminders(@CurrentUser() user: AuthUser) {
    return this.comms.listReminders(user);
  }

  @Post('reminders')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  createReminder(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.comms.createReminder(user, body);
  }

  @Get('outbound')
  outbound(
    @CurrentUser() user: AuthUser,
    @Query('fileId') fileId?: string,
    @Query('channel') channel?: string,
  ) {
    return this.comms.listOutbound(user, fileId, channel);
  }

  @Get('preview')
  preview(
    @CurrentUser() user: AuthUser,
    @Query('fileId') fileId: string,
    @Query('purpose') purpose: string,
    @Query('channel') channel?: string,
    @Query('examinerName') examinerName?: string,
  ) {
    return this.comms.previewForFile(user, fileId, purpose, channel, examinerName);
  }

  @Get('outbound/:id')
  outboundOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comms.getOutbound(user, id);
  }

  @Post('drafts')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  saveDraft(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.comms.saveDraft(user, body);
  }

  @Patch('outbound/:id')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  updateDraft(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.comms.updateDraft(user, id, body);
  }

  @Post('outbound/:id/send')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  sendDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comms.sendDraft(user, id);
  }

  @Post('send')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  send(@CurrentUser() user: AuthUser, @Body() body: { templateId: string; fileId: string; to: string }) {
    return this.comms.sendTemplate(user, body.templateId, body.fileId, body.to);
  }

  @Post('test-mail')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  sendTest(
    @CurrentUser() user: AuthUser,
    @Body() body: { to: string; subject?: string; body?: string },
  ) {
    return this.comms.sendTestMail(user, body);
  }

  @Post('remunerate/:fileId')
  @UseGuards(RolesGuard)
  @Roles(...Writers)
  remunerate(@CurrentUser() user: AuthUser, @Param('fileId') fileId: string) {
    return this.comms.remunerate(user, fileId);
  }
}
