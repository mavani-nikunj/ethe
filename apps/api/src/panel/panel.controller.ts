import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { InstituteGuard } from '../common/institute.guard';
import { PanelService } from './panel.service';
import { CurrentUser, AuthUser } from '../common/current-user';

@Controller('files')
@UseGuards(AuthGuard('jwt'), InstituteGuard)
export class PanelBulkController {
  constructor(private panel: PanelService) {}

  @Post('bulk-request-panel')
  bulkRequest(@CurrentUser() user: AuthUser, @Body() body: { ids?: string[] }) {
    return this.panel.bulkRequestPanel(user, body?.ids || []);
  }

  @Post('bulk-resend-panel')
  bulkResend(@CurrentUser() user: AuthUser, @Body() body: { ids?: string[] }) {
    return this.panel.bulkResendPanel(user, body?.ids || []);
  }
}

@Controller('files/:id/panel')
@UseGuards(AuthGuard('jwt'), InstituteGuard)
export class PanelController {
  constructor(private panel: PanelService) {}

  @Get('known')
  known(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('q') q?: string) {
    return this.panel.listKnownExaminers(user.instituteId as string, q, id);
  }

  @Post('members')
  add(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.panel.addMember(user, id, body);
  }

  @Patch('members/:index')
  @UseInterceptors(
    FileInterceptor('cheque', {
      storage: diskStorage({
        destination: (_req, _f, cb) => {
          const dir = join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'task');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase() || '.png';
          cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
        },
      }),
    }),
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('index') index: string,
    @Body() body: any,
    @UploadedFile() cheque?: Express.Multer.File,
  ) {
    return this.panel.updateMember(
      user,
      id,
      Number(index),
      body,
      cheque?.filename ? `task/${cheque.filename}` : undefined,
    );
  }

  @Post('members/:index/remove')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('index') index: string) {
    return this.panel.removeMember(user, id, Number(index));
  }

  @Post('submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.panel.submitPanel(user, id);
  }

  @Post('practical')
  assignPractical(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.panel.assignPractical(user, id, body);
  }

  @Get('practical-details')
  practicalDetails(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.panel.practicalDetails(user, id);
  }

  @Post('assign')
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { indexes: number[]; assigned: boolean }) {
    return this.panel.assign(user, id, body.indexes || [], body.assigned !== false);
  }

  @Post('request')
  request(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { resend?: boolean }) {
    return this.panel.requestPanelLink(user, id, !!body?.resend);
  }

  @Post('additional')
  additional(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.panel.requestAdditionalPanel(user, id);
  }

  @Post('offers')
  offers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.panel.sendOffers(user, id);
  }

  @Post('members/:index/propose')
  propose(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('index') index: string) {
    return this.panel.proposeLeftover(user, id, Number(index));
  }

  @Post('members/:index/offer')
  resendOffer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('index') index: string) {
    return this.panel.resendOffer(user, id, Number(index));
  }

  @Post('dispatch')
  dispatch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.panel.sendEvalLinks(user, id);
  }

  @Post('members/:index/eval')
  resendEval(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('index') index: string) {
    return this.panel.resendEval(user, id, Number(index));
  }

  @Post('nth')
  nth(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body('index') index: number) {
    return this.panel.pickNth(user, id, index);
  }

  @Post('members/:index/travel')
  travel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('index') index: string,
    @Body() body: Record<string, string>,
  ) {
    return this.panel.updateTravel(user, id, Number(index), body);
  }

  @Post('members/:index/vet')
  vet(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('index') index: string,
    @Body() body: { status: string; remark?: string },
  ) {
    return this.panel.vetMember(user, id, Number(index), body.status, body.remark);
  }
}
