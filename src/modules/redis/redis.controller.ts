import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/role.decorator';
import { Role } from '../../common/enums/role-enum';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UpdateLocationDto } from './dto/update-location.dto';
import { RedisService } from './redis.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

const bodyPipe = new ValidationPipe({ whitelist: true, transform: true });

/**
 * Two routes instead of one so the role comes from the guard, not from
 * anything the client sends. The user id always comes from the JWT.
 */
@Controller('location')
@UseGuards(JwtGuard, RolesGuard)
export class RedisController {
  constructor(private readonly redisService: RedisService) {}

  @Post('driver')
  @Roles(Role.DRIVER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateDriver(
    @Body(bodyPipe) dto: UpdateLocationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.redisService.update(
      req.user.sub,
      'driver',
      dto,
      dto.accuracy_meters ?? null,
    );
  }

  @Post('responder')
  @Roles(Role.RESPONDER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateResponder(
    @Body(bodyPipe) dto: UpdateLocationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.redisService.update(
      req.user.sub,
      'responder',
      dto,
      dto.accuracy_meters ?? null,
    );
  }
}
