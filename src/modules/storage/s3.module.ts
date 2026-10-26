import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { StorageController } from './s3.controller';
import { S3Service } from './s3.service';

@Module({
  imports: [ConfigModule, JwtModule.register({})],
  controllers: [StorageController],
  providers: [S3Service],
  exports: [S3Service],
})
export class StorageModule {}
