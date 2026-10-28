import { Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { PlatformOnlyGuard } from '../common/platform.guard';
import { PlatformService } from './platform.service';
import { CurrentUser, AuthUser } from '../common/current-user';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

class CreateInstituteDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() displayName?: string;
  @IsString() @MinLength(2) code: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() primaryColor?: string;
  @IsOptional() @IsString() supportEmail?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() dateFormat?: string;
  @IsOptional() @Type(() => Number) @IsNumber() seats?: number;
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
  @IsOptional() @IsArray() featureFlags?: string[];
  @IsOptional() @IsEmail() adminEmail?: string;
  @IsOptional() @IsString() adminName?: string;
  @IsOptional() @IsString() adminMobile?: string;
  @IsOptional() @IsString() adminDesignation?: string;
}

class InviteAdminDto {
  @IsEmail() email: string;
  @IsString() name: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() designation?: string;
}

@Controller('platform')
@UseGuards(AuthGuard('jwt'), PlatformOnlyGuard)
export class PlatformController {
  constructor(private platform: PlatformService) {}

  @Get('dashboard')
  dashboard() {
    return this.platform.dashboard();
  }

  @Get('institutes')
  list(@Query('q') q?: string, @Query('status') status?: string) {
    return this.platform.list(q, status);
  }

  @Post('institutes')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInstituteDto) {
    return this.platform.create(user, dto);
  }

  @Get('institutes/:id')
  get(@Param('id') id: string) {
    return this.platform.get(id);
  }

  @Patch('institutes/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.platform.update(user, id, body);
  }

  @Patch('institutes/:id/status')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body('status') status: string) {
    return this.platform.setStatus(user, id, status);
  }

  @Post('institutes/:id/admin')
  invite(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InviteAdminDto) {
    return this.platform.inviteAdmin(user, id, dto);
  }

  @Post('institutes/:id/logo')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: (req: any, _file, cb) => {
          const dir = join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'platform', String(req.params.id));
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          cb(null, `logo-${Date.now()}${extname(file.originalname || '.png')}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(file.mimetype)) {
          cb(new BadRequestException('Upload a PNG, JPG, GIF, WebP or SVG logo'), false);
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadLogo(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose a logo image');
    return this.platform.setLogo(user, id, `platform/${id}/${file.filename}`);
  }

  @Get('audit-logs')
  logs(@Query('q') q?: string) {
    return this.platform.auditLogs(q);
  }
}
