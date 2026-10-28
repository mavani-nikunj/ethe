import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@ethesis/shared';
import { InstituteGuard } from '../common/institute.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, AuthUser } from '../common/current-user';
import { StaffDutyService } from './staff-duty.service';

/**
 * Staff Duty menu (examination staff invigilation duty). Read: Dealing, ACE, Assoc. Dean, Institute Admin.
 * Dealing writes; lock / unlock rules are checked in the service (docs/staff-duty-plan.md §8.5).
 */
@Controller('staff-duty')
@UseGuards(AuthGuard('jwt'), InstituteGuard, RolesGuard)
@Roles(UserRole.DEALING, UserRole.AUTHORITY, UserRole.INSTITUTE_ADMIN)
export class StaffDutyController {
  constructor(private svc: StaffDutyService) {}

  @Get('meta')
  meta(@CurrentUser() user: AuthUser) {
    return this.svc.meta(user);
  }

  // ----- staff (Add Staff / Duty Assigned)

  @Get('members')
  members(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.listMembers(user, q);
  }

  @Post('members')
  addMember(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.addMember(user, body);
  }

  @Post('members/remove')
  removeMembers(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.removeMembers(user, body);
  }

  @Post('members/copy-from')
  copyFrom(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.copyFrom(user, body);
  }

  @Patch('members/:id')
  updateMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateMember(user, id, body);
  }

  @Get('staff')
  staff(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.searchStaff(user, q);
  }

  // ----- exam duty

  @Get('sittings')
  sittings(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.listSittings(user, q);
  }

  @Post('sittings')
  createSitting(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.createSitting(user, body);
  }

  @Post('sittings/delete')
  deleteSittings(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.deleteSittings(user, body);
  }

  @Patch('sittings/:id')
  updateSitting(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateSitting(user, id, body);
  }

  @Get('sittings/:id/candidates')
  candidates(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() q: any) {
    return this.svc.sittingCandidates(user, id, q);
  }

  // ----- staff preference

  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.listPreferences(user, q);
  }

  @Post('preferences')
  savePreferences(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.savePreferences(user, body);
  }

  @Post('preferences/clear')
  clearPreferences(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.clearPreferences(user, body);
  }

  // ----- allotment

  @Post('allot')
  allot(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.allot(user, body);
  }

  @Get('allotments')
  allotments(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.listAllotments(user, q);
  }

  @Post('allotments')
  addAllotment(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.addAllotment(user, body);
  }

  @Post('allotments/delete')
  deleteAllotments(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.deleteAllotments(user, body);
  }

  @Get('allotments/:id/replacements')
  replacements(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.replacements(user, id);
  }

  @Post('allotments/:id/replace')
  replace(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.svc.replace(user, id, body);
  }

  @Post('lock')
  lock(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.lock(user, body);
  }

  @Post('unlock')
  unlock(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.unlock(user, body);
  }

  // ----- duty lists

  @Get('duty-list')
  dutyList(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.dutyList(user, q);
  }

  @Patch('settings')
  settings(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.updateSettings(user, body);
  }
}
