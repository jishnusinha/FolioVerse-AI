import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma.service';

@ApiTags('notifications')
@Controller('workspaces/:workspaceId/notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser) {
    return this.prisma.notification.findMany({ where: { workspaceId, userId: u.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @HttpCode(204)
  @Post('read-all')
  async readAll(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser) {
    await this.prisma.notification.updateMany({ where: { workspaceId, userId: u.id, readAt: null }, data: { readAt: new Date() } });
  }
}
