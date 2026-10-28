import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { UserRole } from '@ethesis/shared';
import { InstituteGuard } from '../common/institute.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, AuthUser } from '../common/current-user';
import { TravelService } from './travel.service';
import { practicalUpload, sendUpload } from './practical-files';

/** Travel Manager login: ticket requests for practical examiners and travel agents. */
@Controller('travel')
@UseGuards(AuthGuard('jwt'), InstituteGuard, RolesGuard)
@Roles(UserRole.TRAVEL)
export class TravelController {
  constructor(private travel: TravelService) {}

  @Get('requests')
  list(@CurrentUser() user: AuthUser, @Query('view') view: string) {
    return this.travel.list(user, view);
  }

  @Post('requests/:id/send-agent')
  sendToAgent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.travel.sendToAgent(user, id, body);
  }

  @Post('requests/:id/ticket')
  @UseInterceptors(FileInterceptor('file', practicalUpload('tickets', /\.(pdf|png|jpe?g)$/i, 'Ticket must be a PDF or image', 10)))
  uploadTicket(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.travel.uploadTicket(user, id, file ? { path: `tickets/${file.filename}`, originalName: file.originalname } : undefined);
  }

  @Get('requests/:id/ticket')
  async ticket(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const t = await this.travel.ticketFile(user, id);
    sendUpload(res, t.path, t.originalName);
  }

  @Post('requests/:id/send-ticket')
  sendTicket(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.travel.sendTicket(user, id);
  }

  @Post('requests/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.travel.cancel(user, id, body);
  }

  @Get('agents')
  agents(@CurrentUser() user: AuthUser) {
    return this.travel.listAgents(user);
  }

  @Post('agents')
  createAgent(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.travel.createAgent(user, body);
  }

  @Patch('agents/:id')
  updateAgent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.travel.updateAgent(user, id, body);
  }

  @Delete('agents/:id')
  removeAgent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.travel.removeAgent(user, id);
  }
}
