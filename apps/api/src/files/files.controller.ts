import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AuthGuard } from '@nestjs/passport';
import { InstituteGuard } from '../common/institute.guard';
import { FilesService } from './files.service';
import { CurrentUser, AuthUser } from '../common/current-user';

/** Thesis files can be very large; uploads stream to disk. */
const THESIS_MAX_BYTES = 5 * 1024 * 1024 * 1024;

function storage() {
  return diskStorage({
    destination: (req: any, _file, cb) => {
      const dir = join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', req.user?.instituteId || 'misc');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`);
    },
  });
}

@Controller('files')
@UseGuards(AuthGuard('jwt'), InstituteGuard)
export class FilesController {
  constructor(private files: FilesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('departmentId') departmentId?: string,
    @Query('stage') stage?: string,
    @Query('program') program?: string,
    @Query('courseTypeId') courseTypeId?: string,
    @Query('bucket') bucket?: string,
    @Query('courseId') courseId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('specialityId') specialityId?: string,
    @Query('session') session?: string,
    @Query('status') status?: string,
    @Query('chiefGuideId') chiefGuideId?: string,
    @Query('lane') lane?: string,
  ): Promise<any[]> {
    return this.files.list(
      user,
      q,
      departmentId,
      stage,
      program,
      courseTypeId,
      bucket,
      courseId,
      month,
      year,
      specialityId,
      session,
      status,
      chiefGuideId,
      lane,
    );
  }

  @Get('inbox')
  inbox(
    @CurrentUser() user: AuthUser,
    @Query('lane') lane?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
    @Query('q') q?: string,
    @Query('departmentId') departmentId?: string,
    @Query('courseTypeId') courseTypeId?: string,
    @Query('courseId') courseId?: string,
    @Query('specialityId') specialityId?: string,
    @Query('stage') stage?: string,
    @Query('status') status?: string,
    @Query('chiefGuideId') chiefGuideId?: string,
  ): Promise<{ items: any[]; lanes: Record<string, number> }> {
    return this.files.inbox(
      user,
      lane,
      month,
      year,
      session,
      q,
      departmentId,
      courseTypeId,
      courseId,
      specialityId,
      stage,
      status,
      chiefGuideId,
    );
  }

  @Get('approved-letters')
  approvedLetters(
    @CurrentUser() user: AuthUser,
    @Query('kind') kind?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
    @Query('q') q?: string,
    @Query('courseId') courseId?: string,
    @Query('specialityId') specialityId?: string,
    @Query('courseTypeId') courseTypeId?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.files.listApprovedLetters(
      user,
      kind,
      month,
      year,
      session,
      q,
      courseId,
      specialityId,
      courseTypeId,
      departmentId,
    );
  }

  @Get('results')
  results(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
  ) {
    return this.files.results(user, month, year, session);
  }

  @Get('submissions')
  submissions(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
  ) {
    return this.files.submissions(user, month, year, session);
  }

  @Get('stats')
  async stats(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
  ) {
    const rows = await this.files.list(user, undefined, undefined, undefined, undefined, undefined, undefined, undefined, month, year, undefined, session);
    return {
      total: rows.length,
      inProgress: rows.filter((r) => r.status === 'IN_PROGRESS').length,
      onHold: rows.filter((r) => r.status === 'ON_HOLD').length,
      completed: rows.filter((r) => r.status === 'COMPLETED').length,
    };
  }

  @Get('metro-stats')
  metroStats(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
  ) {
    return this.files.metroStats(user, month, year, session);
  }

  @Get('workflow-board')
  workflowBoard(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
    @Query('reminders') reminders?: string,
  ) {
    return this.files.workflowBoard(user, month, year, session, reminders === '1');
  }

  @Get('department-dashboard')
  departmentDashboard(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.files.departmentDashboard(user, month, year);
  }

  @Get('department-report')
  departmentReport(
    @CurrentUser() user: AuthUser,
    @Query('kind') kind?: string,
    @Query('courseId') courseId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('session') session?: string,
  ) {
    return this.files.departmentReport(user, kind || 'notSubmitted', courseId, month, year, session);
  }

  @Post()
  @UseInterceptors(FileInterceptor('thesis', { storage: storage(), limits: { fileSize: THESIS_MAX_BYTES } }))
  create(@CurrentUser() user: AuthUser, @Body() body: any, @UploadedFile() thesis?: Express.Multer.File) {
    const parsed = typeof body.payload === 'string' ? JSON.parse(body.payload) : body;
    const rel = thesis ? `${user.instituteId}/${thesis.filename}` : undefined;
    return this.files.create(user, parsed, rel, thesis?.originalname);
  }

  @Post('send')
  sendMany(@CurrentUser() user: AuthUser, @Body() body: { ids?: string[] }) {
    return this.files.sendMany(user, body?.ids || []);
  }

  @Post('thesis-numbers')
  assignThesisNumbers(
    @CurrentUser() user: AuthUser,
    @Body() body: { items?: { id?: string; thesisNumber?: string }[] },
  ) {
    return this.files.assignThesisNumbers(user, body?.items || []);
  }

  @Post('bulk-approve')
  bulkApprove(@CurrentUser() user: AuthUser, @Body() body: { ids?: string[]; remark?: string }) {
    return this.files.bulkApprove(user, body?.ids || [], body?.remark);
  }

  @Post('bulk-act')
  bulkAct(
    @CurrentUser() user: AuthUser,
    @Body() body: { ids?: string[]; kind?: 'REMINDER' | 'DISPATCH' | 'VET_APPROVE' | 'CLOSE' },
  ) {
    return this.files.bulkAct(user, body?.ids || [], body?.kind as any);
  }

  @Post(':id/send')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.sendToExam(user, id);
  }

  @Get(':id/letters/revision')
  revisionLetter(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('kind') kind?: string,
    @Query('panelIndex') panelIndex?: string,
  ) {
    return this.files.revisionLetter(user, id, kind, panelIndex);
  }

  @Get(':id/audit')
  audit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.auditTrail(user, id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.files.update(user, id, body);
  }

  @Patch(':id/file-no')
  updateFileNo(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { fileNo?: string }) {
    return this.files.updateFileNo(user, id, body?.fileNo);
  }

  @Post(':id/chief-guide')
  saveChiefGuide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.files.saveChiefGuide(user, id, body);
  }

  @Post(':id/guide-change')
  guideChange(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.files.requestGuideChange(user, id, body);
  }

  @Post(':id/guide-change/resolve')
  resolveGuide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.files.resolveGuideChange(user, id, body.approve !== false, body.remark);
  }
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { storage: storage(), limits: { fileSize: THESIS_MAX_BYTES } }))
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() uploaded?: Express.Multer.File,
  ) {
    if (!uploaded) throw new BadRequestException('File is required');
    return this.files.addDocument(user, id, body?.kind, `${user.instituteId}/${uploaded.filename}`, uploaded.originalname);
  }
  addNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body('message') message: string) {
    return this.files.addNote(user, id, message);
  }

  @Post(':id/act')
  act(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.files.act(user, id, body.action, body);
  }

  @Post(':id/revision')
  @UseInterceptors(FileInterceptor('thesis', { storage: storage(), limits: { fileSize: THESIS_MAX_BYTES } }))
  async revision(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() thesis: Express.Multer.File,
  ) {
    const detail = await this.files.get(user, id);
    const file = (detail as any).file;
    const version = (file.documents?.length || 0) + 1;
    file.documents.push({
      kind: 'THESIS',
      version,
      path: `${user.instituteId}/${thesis.filename}`,
      originalName: thesis.originalname,
      uploadedAt: new Date(),
      uploadedBy: user.name,
    });
    await file.save();
    return this.files.act(user, id, 'CONTINUE', { remark: `Revision v${version}` });
  }
}
