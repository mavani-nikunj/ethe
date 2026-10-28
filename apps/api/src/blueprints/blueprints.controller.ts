import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InstituteGuard } from '../common/institute.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@ethesis/shared';
import { BlueprintsService } from './blueprints.service';
import { CurrentUser, AuthUser } from '../common/current-user';

@Controller('blueprints')
@UseGuards(AuthGuard('jwt'), InstituteGuard)
export class BlueprintsController {
  constructor(private blueprints: BlueprintsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.blueprints.list(user);
  }

  @Post('seed')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN)
  seed(@CurrentUser() user: AuthUser) {
    return this.blueprints.seedDefaults(user);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN)
  create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.blueprints.create(user, body);
  }

  @Post('unbind-course-type/:courseTypeId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN)
  unbind(@CurrentUser() user: AuthUser, @Param('courseTypeId') courseTypeId: string) {
    return this.blueprints.unbindCourseType(user, courseTypeId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.blueprints.get(user, id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.blueprints.update(user, id, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.blueprints.remove(user, id);
  }

  @Post(':id/clone')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN)
  clone(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.blueprints.clone(user, id);
  }

  @Post(':id/bind-course-type/:courseTypeId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN)
  bind(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('courseTypeId') courseTypeId: string) {
    return this.blueprints.bindCourseType(user, courseTypeId, id);
  }
}
