import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/role.decorator';
import { ApiRoles } from '../../common/decorators/api-roles.decorator';
import { Role } from '../../common/enums/role-enum';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpdateLocationDto } from './dto/update-location.dto';
import { RedisService } from './redis.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DatabaseService } from '../../database/database.service'; // 👈 Import
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

const bodyPipe = new ValidationPipe({ whitelist: true, transform: true });

/**
 * Two routes instead of one so the role comes from the guard, not from
 * anything the client sends. The user id always comes from the JWT.
 */
@Controller('location')
@UseGuards(JwtGuard, RolesGuard)
@ApiTags('Location')
@ApiBearerAuth('access-token')
export class RedisController {
  constructor(
    private readonly redisService: RedisService,
    private readonly db: DatabaseService,
  ) {}

  @Post('driver')
  @ApiOperation({ summary: 'Update the authenticated driver location' })
  @ApiBody({ type: UpdateLocationDto })
  @ApiResponse({ status: 204, description: 'Driver location updated' })
  @ApiResponse({ status: 400, description: 'Invalid location data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.DRIVER)
  @ApiRoles(Role.DRIVER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateDriver(
    @Body(bodyPipe) dto: UpdateLocationDto,
    @CurrentUser('sub') driverId: string,
  ): Promise<void> {

    await this.redisService.update(
      driverId,
      'driver',
      dto,
      dto.accuracy_meters ?? null,
    );
  }

  @Post('responder')
  @ApiOperation({ summary: 'Update the authenticated responder location' })
  @ApiBody({ type: UpdateLocationDto })
  @ApiResponse({ status: 204, description: 'Responder location updated' })
  @ApiResponse({ status: 400, description: 'Invalid location data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateResponder(
    @Body(bodyPipe) dto: UpdateLocationDto,
    @CurrentUser('sub') responderId: string,
  ): Promise<void> {

    await this.redisService.update(
      responderId,
      'responder',
      dto,
      dto.accuracy_meters ?? null,
    );
  }
}
