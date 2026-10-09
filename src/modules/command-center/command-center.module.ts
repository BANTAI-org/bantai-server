import { Module } from '@nestjs/common';
import { CommandCenterController } from './command-center.controller';
import { CommandCenterService } from './command-center.service';
import { CommandCenterRepository } from './command-center.repository';
import { DatabaseModule } from '../../database/database.module';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';

@Module({
  imports: [DatabaseModule, EmailModule],
  controllers: [CommandCenterController],
  providers: [CommandCenterService, CommandCenterRepository, EmailService],
})
export class CommandCenterModule {}
