import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { sendUpload } from './practical-files';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { PracticalTaskService } from './practical-task.service';

const SESSION_HEADER = 'x-practical-session';

/** Public examiner link (offer accept / regret). Access = link token + email OTP session. */
@Controller('practical-tasks')
export class PracticalTaskController {
  constructor(private tasks: PracticalTaskService) {}

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

  @Get(':token/detail')
  detail(@Param('token') token: string, @Headers(SESSION_HEADER) session?: string) {
    return this.tasks.detail(token, session);
  }

  @Post(':token/accept')
  @UseInterceptors(
    FileInterceptor('cheque', {
      limits: { fileSize: 5 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_req, _f, cb) => {
          const dir = join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'practical');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_r, file, cb) => cb(null, `${randomBytes(16).toString('hex')}${extname(file.originalname).toLowerCase()}`),
      }),
      fileFilter: (_req, file, cb) => {
        const ok = /\.(jpe?g|png|pdf)$/i.test(file.originalname);
        cb(ok ? null : new BadRequestException('Cancelled cheque must be a JPG, PNG or PDF file'), ok);
      },
    }),
  )
  async accept(
    @Param('token') token: string,
    @Headers(SESSION_HEADER) session: string | undefined,
    @Body() body: Record<string, unknown>,
    @UploadedFile() cheque?: Express.Multer.File,
  ) {
    try {
      return await this.tasks.accept(token, session, body, cheque ? `practical/${cheque.filename}` : undefined);
    } catch (err) {
      // Multer stores the file before validation; drop it when the submission is rejected.
      if (cheque?.path) await unlink(cheque.path).catch(() => undefined);
      throw err;
    }
  }

  @Post(':token/regret')
  regret(@Param('token') token: string, @Headers(SESSION_HEADER) session: string | undefined, @Body() body: any) {
    return this.tasks.regret(token, session, body || {});
  }

  // ----- examiner portal -----

  @Get(':token/portal')
  portal(@Param('token') token: string, @Headers(SESSION_HEADER) session?: string) {
    return this.tasks.portal(token, session);
  }

  @Post(':token/portal/practical-date')
  practicalDate(@Param('token') token: string, @Headers(SESSION_HEADER) session: string | undefined, @Body() body: any) {
    return this.tasks.setPracticalDate(token, session, body || {});
  }

  @Post(':token/portal/air-booking')
  airBooking(@Param('token') token: string, @Headers(SESSION_HEADER) session: string | undefined, @Body() body: any) {
    return this.tasks.saveAirBooking(token, session, body || {});
  }

  /** Files open in a new tab, so the session comes as a query parameter here. */
  @Get(':token/portal/doc/:docId')
  async doc(@Param('token') token: string, @Param('docId') docId: string, @Query('s') session: string, @Res() res: Response) {
    const doc = await this.tasks.portalDocument(token, session, docId);
    if (!doc) throw new NotFoundException('Document not found');
    sendUpload(res, doc.path, doc.originalName);
  }

  @Get(':token/portal/ticket')
  async ticket(@Param('token') token: string, @Query('s') session: string, @Res() res: Response) {
    const t = await this.tasks.portalTicket(token, session);
    sendUpload(res, t.path, t.originalName);
  }
}
