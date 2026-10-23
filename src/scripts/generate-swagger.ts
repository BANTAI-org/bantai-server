import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs from 'fs';

// Core
import { AppModule } from '../app.module';

// Modules
import { AuthModule } from '../modules/auth/auth.module';
import { CommandCenterModule } from '../modules/command-center/command-center.module';
import { EmailModule } from '../modules/email/email.module';
import { RespondersModule } from '../modules/responders/responders.module';
import { DriverModule } from '../modules/drivers/drivers.module';
import { SmsModule } from '../modules/sms/sms.module';
import { IncidentModule } from '../modules/incidents/incidents.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { DevicesModule } from '../modules/devices/devices.module';
import { GpsModule } from '../modules/gps/gps.module';
import { WaveDispatchModule } from '../modules/wave-dispatch/wave-dispatch.module';
import { DashboardModule } from '../modules/dashboard/dashboard.module';
import { StorageModule } from '../modules/storage/s3.module';
import { CommunicationsModule } from '../modules/communications/comms.module';

/**
 * Helper function to generate a Swagger document.
 */
async function generateSwaggerDoc(
  app: NestFastifyApplication,
  filename: string,
  title: string,
  modulesToInclude: any[] = [],
): Promise<void> {
  const config = new DocumentBuilder()
    .setTitle(title)
    .setDescription(`API Contract for ${title}`)
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT access token',
        in: 'header',
      },
      'access-token',
    )
    .build();

  const options =
    modulesToInclude.length > 0 ? { include: modulesToInclude } : {};

  const document = SwaggerModule.createDocument(app, config, options);

  // 👇 FIX: Use fs.promises.writeFile (async) instead of writeFileSync
  await fs.promises.writeFile(
    `./${filename}`,
    JSON.stringify(document, null, 2),
  );
  console.log(`✅ Generated: ${filename}`);
}

async function generate(): Promise<void> {
  console.log('Initializing NestJS App to extract Swagger data...');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );

  // 1. GLOBAL (Everything)
  await generateSwaggerDoc(app, 'swagger.json', 'Bantai Full API');

  // 2. COMMS TEAM (Radio & Chat)
  await generateSwaggerDoc(
    app,
    'comms-swagger.json',
    'Bantai Communications API',
    [CommunicationsModule, AuthModule],
  );

  // 3. DISPATCH & DASHBOARD TEAM (Command Center & Web)
  await generateSwaggerDoc(
    app,
    'dispatch-swagger.json',
    'Bantai Dispatch & Dashboard API',
    [
      IncidentModule,
      RespondersModule,
      CommandCenterModule,
      DashboardModule,
      WaveDispatchModule,
      AuthModule,
    ],
  );

  // 4. MOBILE & HARDWARE TEAM (Flutter App & Raspberry Pi)
  await generateSwaggerDoc(
    app,
    'mobile-swagger.json',
    'Bantai Mobile & Hardware API',
    [
      DriverModule,
      StorageModule,
      DevicesModule,
      GpsModule,
      IncidentModule,
      AuthModule,
    ],
  );

  // 5. ADMIN & SYSTEM TEAM (Audit, SMS, Emails)
  await generateSwaggerDoc(
    app,
    'admin-swagger.json',
    'Bantai Admin & System API',
    [AuditLogsModule, SmsModule, EmailModule, AuthModule],
  );

  await app.close();
  console.log('🎉 Done generating all Swagger files.');
}

generate().catch((err) => {
  console.error('Failed to generate Swagger documents:', err);
  process.exit(1);
});
