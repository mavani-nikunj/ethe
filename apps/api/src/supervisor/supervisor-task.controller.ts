import { Body, Controller, Get, Headers, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { practicalUpload, removeUpload } from '../practical/practical-files';
import { SupervisorTaskService } from './supervisor-task.service';
import { CHEQUE_FOLDER, CHEQUE_PATTERN } from './supervisor-files';

const SESSION_HEADER = 'x-supervisor-session';

/** Public supervisor link (accept / regret). Access = link token + email OTP session. */
@Controller('supervisor-tasks')
export class SupervisorTaskController {
  constructor(private tasks: SupervisorTaskService) {}

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
  @UseInterceptors(FileInterceptor('cheque', practicalUpload(CHEQUE_FOLDER, CHEQUE_PATTERN, 'Cancelled cheque must be a JPG, PNG or PDF file')))
  async accept(
    @Param('token') token: string,
    @Headers(SESSION_HEADER) session: string | undefined,
    @Body() body: Record<string, unknown>,
    @UploadedFile() cheque?: Express.Multer.File,
  ) {
    const path = cheque ? `${CHEQUE_FOLDER}/${cheque.filename}` : undefined;
    try {
      return await this.tasks.accept(token, session, body, path);
    } catch (err) {
      // Multer stores the file before validation; drop it when the submission is rejected.
      await removeUpload(path);
      throw err;
    }
  }

  @Post(':token/regret')
  regret(@Param('token') token: string, @Headers(SESSION_HEADER) session: string | undefined, @Body() body: any) {
    return this.tasks.regret(token, session, body || {});
  }
}
