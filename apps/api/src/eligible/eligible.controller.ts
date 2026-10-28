import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@ethesis/shared';
import { InstituteGuard } from '../common/institute.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, AuthUser } from '../common/current-user';
import { EligibleService } from './eligible.service';
import { ExamPapersService } from './exam-papers.service';
import { ExamHallsService } from './exam-halls.service';
import { SeatAllotmentService } from './seat-allotment.service';

/**
 * Eligible Candidate menu (theory examination). Read access: Dealing, Authority (Assoc. Dean / ACE),
 * Institute Admin. Writes are Dealing-only inside the service.
 */
@Controller('eligible')
@UseGuards(AuthGuard('jwt'), InstituteGuard, RolesGuard)
@Roles(UserRole.DEALING, UserRole.AUTHORITY, UserRole.INSTITUTE_ADMIN)
export class EligibleController {
  constructor(
    private eligible: EligibleService,
    private papers: ExamPapersService,
    private halls: ExamHallsService,
    private allotment: SeatAllotmentService,
  ) {}

  @Get('meta')
  meta(@CurrentUser() user: AuthUser) {
    return this.eligible.meta(user);
  }

  @Get('counts')
  counts(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.eligible.counts(user, q);
  }

  @Post('specialities')
  addSpeciality(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.eligible.addSpeciality(user, body);
  }

  @Post('departments')
  addDepartment(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.eligible.addDepartment(user, body);
  }

  @Get('candidates')
  list(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.eligible.list(user, q);
  }

  @Post('candidates')
  create(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.eligible.create(user, body);
  }

  @Post('candidates/not-eligible')
  notEligible(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.eligible.markNotEligible(user, body);
  }

  @Post('candidates/eligible')
  eligibleAgain(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.eligible.markEligible(user, body);
  }

  @Get('candidates/:id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.eligible.getOne(user, id);
  }

  @Patch('candidates/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.eligible.update(user, id, body);
  }

  @Get('previous')
  previous(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.eligible.previous(user, q);
  }

  @Post('previous/carry')
  carry(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.eligible.carry(user, body);
  }

  // ---------- Add Venue (paper schedule) ----------

  @Get('shifts')
  shifts(@CurrentUser() user: AuthUser) {
    return this.papers.listShifts(user);
  }

  @Post('shifts')
  addShift(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.papers.addShift(user, body);
  }

  @Get('time-slots')
  timeSlots(@CurrentUser() user: AuthUser) {
    return this.papers.listTimeSlots(user);
  }

  @Post('time-slots')
  addTimeSlot(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.papers.addTimeSlot(user, body);
  }

  @Get('papers')
  listPapers(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.papers.list(user, q);
  }

  @Post('papers')
  createPaper(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.papers.create(user, body);
  }

  @Patch('papers/:id')
  updatePaper(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.papers.update(user, id, body);
  }

  @Delete('papers/:id')
  removePaper(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.papers.remove(user, id);
  }

  // ---------- Hall Master ----------

  @Get('halls')
  listHalls(@CurrentUser() user: AuthUser) {
    return this.halls.list(user);
  }

  @Post('halls')
  createHall(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.halls.create(user, body);
  }

  @Get('halls/:id')
  getHall(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.halls.getOne(user, id);
  }

  @Patch('halls/:id')
  renameHall(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.halls.rename(user, id, body);
  }

  @Delete('halls/:id')
  removeHall(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.halls.remove(user, id);
  }

  @Post('halls/:id/rows')
  addRow(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.halls.addRow(user, id, body);
  }

  @Patch('halls/:id/seats/:seatNo')
  setSeat(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('seatNo') seatNo: string, @Body() body: any) {
    return this.halls.setSeat(user, id, seatNo, body);
  }

  @Delete('halls/:id/seats/:seatNo')
  removeSeat(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('seatNo') seatNo: string) {
    return this.halls.removeSeat(user, id, seatNo);
  }

  // ---------- Seat Allotment & Reports ----------

  @Get('allotment/dates')
  allotmentDates(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.allotment.dates(user, q);
  }

  @Get('allotment/report')
  allotmentReport(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.allotment.report(user, q);
  }

  @Post('allotment')
  openAllotment(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.allotment.open(user, body);
  }

  @Get('allotment/:id')
  getAllotment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.allotment.getOne(user, id);
  }

  @Put('allotment/:id/seating')
  seating(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.allotment.seating(user, id, body);
  }

  @Patch('allotment/:id/seats')
  toggleAllotmentSeat(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.allotment.toggleSeat(user, id, body);
  }

  @Post('allotment/:id/process')
  processAllotment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.allotment.process(user, id);
  }

  @Post('allotment/:id/lock')
  lockAllotment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.allotment.lock(user, id);
  }
}
