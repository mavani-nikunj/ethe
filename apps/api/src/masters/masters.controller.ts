import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InstituteGuard } from '../common/institute.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@ethesis/shared';
import { MastersService } from './masters.service';
import { CurrentUser, AuthUser } from '../common/current-user';

@Controller('masters')
@UseGuards(AuthGuard('jwt'), InstituteGuard)
export class MastersController {
  constructor(private masters: MastersService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.masters.overview(user);
  }

  @Post('ensure-defaults')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN)
  defaults(@CurrentUser() user: AuthUser) {
    return this.masters.ensureDefaults(user);
  }

  @Get('staff')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.ACADEMIC, UserRole.DEALING)
  staff(@CurrentUser() user: AuthUser) {
    return this.masters.staff(user);
  }

  @Post('staff')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.ACADEMIC)
  createStaff(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.masters.createStaff(user, body);
  }

  @Post('staff/:id/reset-password')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.ACADEMIC)
  resetStaffPassword(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.masters.resetStaffPassword(user, id);
  }

  @Get('department-users')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.ACADEMIC)
  departmentUsers(@CurrentUser() user: AuthUser) {
    return this.masters.departmentUsers(user);
  }

  @Post('department-users/:id/invite')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.ACADEMIC)
  inviteDept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.masters.inviteDepartmentUser(user, id);
  }

  @Patch('staff/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.ACADEMIC)
  updateStaff(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.masters.updateStaff(user, id, body);
  }

  @Delete('staff/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.ACADEMIC)
  removeStaff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.masters.removeStaff(user, id);
  }

  @Get('sessions/current')
  currentSession(@CurrentUser() user: AuthUser) {
    return this.masters.currentSession(user);
  }

  @Post('sessions/activate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DEALING, UserRole.INSTITUTE_ADMIN)
  activateSession(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.masters.activateSession(user, body);
  }

  @Get(':kind')
  list(@CurrentUser() user: AuthUser, @Param('kind') kind: string) {
    const model = this.masters.models()[kind];
    if (!model) return [];
    return this.masters.list(model, user);
  }

  @Post(':kind')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.COURSE, UserRole.DEALING, UserRole.ACADEMIC)
  create(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @Body() body: Record<string, unknown>) {
    const model = this.masters.models()[kind];
    return this.masters.create(model, user, body);
  }

  @Patch(':kind/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.DEALING, UserRole.ACADEMIC)
  update(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const model = this.masters.models()[kind];
    return this.masters.update(model, user, id, body);
  }

  @Delete(':kind/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.COURSE, UserRole.DEALING)
  remove(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @Param('id') id: string) {
    const model = this.masters.models()[kind];
    return this.masters.remove(model, user, id);
  }
}
