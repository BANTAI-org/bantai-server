import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { StorageController } from './s3.controller';
import { S3Service } from './s3.service';
import { ClipsRepository } from './clips.repository';
import { ClipsService } from './clips.service';

@Module({
  imports: [ConfigModule, DatabaseModule, JwtModule.register({})],
  controllers: [StorageController],
  providers: [S3Service, ClipsRepository, ClipsService],
  exports: [S3Service],
})
export class StorageModule {}
