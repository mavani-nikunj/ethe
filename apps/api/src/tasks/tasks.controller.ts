import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { TasksService } from './tasks.service';

/** Cancelled cheque: JPG, PNG or PDF up to 10 MB. Some phone pickers send names without an extension, so the type counts too. */
const CHEQUE_MAX_BYTES = 10 * 1024 * 1024;
const CHEQUE_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' };
const CHEQUE_EXT = /\.(jpe?g|png|pdf)$/i;

function chequeExt(file: Express.Multer.File) {
  const ext = extname(file.originalname || '');
  return CHEQUE_EXT.test(ext) ? ext : CHEQUE_TYPES[String(file.mimetype || '').toLowerCase()] || ext;
}

/** Thesis files can be very large; uploads stream to disk. */
const THESIS_MAX_BYTES = 5 * 1024 * 1024 * 1024;

@Controller('tasks')
export class TasksController {
  constructor(private tasks: TasksService) {}

  @Get(':token')
  peek(@Param('token') token: string) {
    return this.tasks.peek(token);
  }

  @Post(':token/otp')
  otp(@Param('token') token: string) {
    return this.tasks.sendOtp(token);
  }

  @Post(':token/verify')
  verify(@Param('token') token: string, @Body('otp') otp: string) {
    return this.tasks.verify(token, otp);
  }

  @Get(':token/assigned')
  assigned(@Param('token') token: string) {
    return this.tasks.listAssigned(token);
  }

  @Get(':token/detail')
  detail(@Param('token') token: string) {
    return this.tasks.detail(token);
  }

  /** Institute-wide examiners for the Chief Guide picker (other theses + pool). */
  @Get(':token/examiners')
  examiners(@Param('token') token: string, @Query('q') q?: string) {
    return this.tasks.listExaminers(token, q);
  }

  @Post(':token/panel/members')
  addMember(@Param('token') token: string, @Body() body: any) {
    return this.tasks.addPanelMember(token, body);
  }

  /** Chief Guide edits an examiner (matched by current email) before submitting the panel. */
  @Patch(':token/panel/members/:email')
  updateMember(@Param('token') token: string, @Param('email') email: string, @Body() body: any) {
    return this.tasks.updatePanelMember(token, email, body);
  }

  /** Chief Guide removes an examiner (matched by email) before submitting the panel. */
  @Post(':token/panel/members/:email/remove')
  removeMember(@Param('token') token: string, @Param('email') email: string) {
    return this.tasks.removePanelMember(token, email);
  }

  @Post(':token/panel/submit')
  submitPanel(@Param('token') token: string) {
    return this.tasks.submitPanel(token);
  }

  @Post(':token/consent')
  @UseInterceptors(
    FileInterceptor('cheque', {
      limits: { fileSize: CHEQUE_MAX_BYTES },
      storage: diskStorage({
        destination: (_req, _f, cb) => {
          const dir = join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'task');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_r, file, cb) => cb(null, `${Date.now()}-cheque${chequeExt(file)}`),
      }),
      fileFilter: (_req, file, cb) => {
        const ok = CHEQUE_EXT.test(file.originalname || '') || Boolean(CHEQUE_TYPES[String(file.mimetype || '').toLowerCase()]);
        cb(ok ? null : new BadRequestException('Cancelled cheque must be a JPG, PNG or PDF file. The file you selected is not supported.'), ok);
      },
    }),
  )
  consent(
    @Param('token') token: string,
    @Body() body: any,
    @UploadedFile() cheque?: Express.Multer.File,
  ) {
    return this.tasks.consent(token, body, cheque ? `task/${cheque.filename}` : undefined);
  }

  @Post(':token/evaluate')
  evaluate(@Param('token') token: string, @Body() body: any) {
    return this.tasks.evaluate(token, body);
  }

  @Post(':token/viva-date')
  vivaDate(@Param('token') token: string, @Body() body: any) {
    return this.tasks.setVivaDate(token, body || {});
  }

  @Post(':token/revision')
  @UseInterceptors(
    FileInterceptor('thesis', {
      limits: { fileSize: THESIS_MAX_BYTES },
      storage: diskStorage({
        destination: (_req, _f, cb) => {
          const dir = join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'task');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_r, file, cb) => cb(null, `${Date.now()}${extname(file.originalname)}`),
      }),
    }),
  )
  revision(@Param('token') token: string, @UploadedFile() thesis: Express.Multer.File) {
    return this.tasks.uploadRevision(token, `task/${thesis.filename}`, thesis.originalname);
  }
}
