import { Body, Controller, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AuthGuard } from '@nestjs/passport';
import { InstituteGuard } from '../common/institute.guard';
import { EvaluationService } from './evaluation.service';
import { CurrentUser, AuthUser } from '../common/current-user';

@Controller('files/:id/evaluation')
@UseGuards(AuthGuard('jwt'), InstituteGuard)
export class EvaluationController {
  constructor(private evaluation: EvaluationService) {}

  @Get('checklist')
  checklist() {
    return this.evaluation.checklist();
  }

  @Post()
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.evaluation.submit(user, id, body);
  }

  @Post('revision')
  @UseInterceptors(
    FileInterceptor('thesis', {
      limits: { fileSize: 5 * 1024 * 1024 * 1024 },
      storage: diskStorage({
        destination: (req: any, _f, cb) => {
          const dir = join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', req.user?.instituteId || 'misc');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_r, file, cb) => cb(null, `${Date.now()}${extname(file.originalname)}`),
      }),
    }),
  )
  revision(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFile() thesis: Express.Multer.File) {
    return this.evaluation.applyRevision(user, id, `${user.instituteId}/${thesis.filename}`, thesis.originalname);
  }
}
