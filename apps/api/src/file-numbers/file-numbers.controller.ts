import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@ethesis/shared';
import { InstituteGuard } from '../common/institute.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, AuthUser } from '../common/current-user';
import { FileNumbersService } from './file-numbers.service';

@Controller('file-numbers')
@UseGuards(AuthGuard('jwt'), InstituteGuard, RolesGuard)
@Roles(UserRole.DEALING)
export class FileNumbersController {
  constructor(private fileNumbers: FileNumbersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.fileNumbers.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.fileNumbers.create(user, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.fileNumbers.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.fileNumbers.remove(user, id);
  }
}
