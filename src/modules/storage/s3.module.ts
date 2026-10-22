import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageController } from './s3.controller';
import { S3Service } from './s3.service';

@Module({
  imports: [ConfigModule],
  controllers: [StorageController],
  providers: [S3Service],
  exports: [S3Service],
})
export class StorageModule {}
