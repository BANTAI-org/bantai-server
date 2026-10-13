import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DevicesRepository } from './devices.repository';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService, DevicesRepository],
  exports: [DevicesService],
})
export class DevicesModule {}
