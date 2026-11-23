import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';
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
import { DashboardModule } from '../modules/dashboard/dashboard.module';
import { StorageModule } from '../modules/storage/s3.module';
import { CommunicationsModule } from '../modules/communications/comms.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { RedisModule } from '../modules/redis/redis.module';

/**
 * Filters the generated Swagger document based on allowed roles.
 */
function filterSwaggerByRole(
  document: OpenAPIObject,
  allowedRoles: string[],
): OpenAPIObject {
  const filteredPaths: Record<string, any> = {};

  // Normalize allowed roles to lowercase for comparison
  const normalizedAllowedRoles = allowedRoles.map((r) => r.toLowerCase());

  for (const [path, methods] of Object.entries(document.paths || {})) {
    const filteredMethods: Record<string, any> = {};

    for (const [method, operation] of Object.entries(
      methods as Record<string, any>,
    )) {
      const op = operation as Record<string, any>;

      const endpointRoles: string[] = Array.isArray(op['x-roles'])
        ? (op['x-roles'] as string[]).map((r) => r.toLowerCase())
        : [];

      const securityArray: unknown[] = Array.isArray(op.security)
        ? op.security
        : [];
      const isPublic = securityArray.length === 0;

      // Compare normalized roles
      if (
        (isPublic && normalizedAllowedRoles.includes('public')) ||
        endpointRoles.some((role) => normalizedAllowedRoles.includes(role))
      ) {
        filteredMethods[method] = op;
      }
    }

    if (Object.keys(filteredMethods).length > 0) {
      filteredPaths[path] = filteredMethods;
    }
  }

  return { ...document, paths: filteredPaths };
}

async function generateSwaggerDoc(
  app: NestFastifyApplication,
  filename: string,
  title: string,
  modulesToInclude: any[] = [],
  allowedRoles: string[] = [],
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

  let document: OpenAPIObject = SwaggerModule.createDocument(
    app,
    config,
    options,
  );

  if (allowedRoles.length > 0) {
    document = filterSwaggerByRole(document, allowedRoles);
  }

  const outputPath = `./env-${filename}`;
  await fs.promises.writeFile(outputPath, JSON.stringify(document, null, 2));

  const roleInfo = allowedRoles.length
    ? ` (Roles: ${allowedRoles.join(', ')})`
    : ' (All Roles)';
  console.log(`Generated: ${outputPath}${roleInfo}`);
}

async function generate(): Promise<void> {
  console.log('Initializing NestJS App to extract Swagger data...');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );

  await generateSwaggerDoc(app, 'swagger.json', 'Bantai Full API');

  await generateSwaggerDoc(
    app,
    'comms-swagger.json',
    'Bantai Communications API',
    [CommunicationsModule, AuthModule],
  );

  await generateSwaggerDoc(
    app,
    'rider-comms.swagger.json',
    'Bantai Rider Comms API',
    [CommunicationsModule],
    ['DRIVER', 'public'],
  );

  await generateSwaggerDoc(
    app,
    'responder-comms.swagger.json',
    'Bantai Responder Comms API',
    [CommunicationsModule],
    ['RESPONDER', 'public'],
  );

  await generateSwaggerDoc(
    app,
    'dispatch-swagger.json',
    'Bantai Dispatch & Dashboard API',
    [
      IncidentModule,
      RespondersModule,
      CommandCenterModule,
      DashboardModule,
      AuthModule,
      CommunicationsModule,
    ],
  );

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
      CommunicationsModule,
      AuthModule,
    ],
  );

  await generateSwaggerDoc(
    app,
    'command-center-swagger.json',
    'Bantai Command Center API',
    [CommandCenterModule],
  );

  await generateSwaggerDoc(
    app,
    'admin-swagger.json',
    'Bantai Admin & System API',
    [AuditLogsModule, SmsModule, EmailModule, AuthModule],
  );

  await generateSwaggerDoc(
    app,
    'driver-app-swagger.json',
    'Bantai Driver Mobile API',
    [],
    ['DRIVER', 'public'],
  );

  await generateSwaggerDoc(
    app,
    'driver-app-2-swagger.json',
    'Bantai Driver Mobile API',
    [DriverModule, StorageModule, RedisModule, CommunicationsModule],
    ['DRIVER', 'public'],
  );

  await generateSwaggerDoc(
    app,
    'responder-app-swagger.json',
    'Bantai Responder Mobile API',
    [CommunicationsModule],
    ['RESPONDER', 'public'],
  );

  await generateSwaggerDoc(
    app,
    'admin-dashboard-swagger.json',
    'Bantai Admin Dashboard API',
    [],
    ['ADMIN', 'SUPER', 'public'],
  );

  await generateSwaggerDoc(
    app,
    'notifications-swagger.json',
    'bantai responder notification api endpoints',
    [NotificationsModule],
  );

  await app.close();
  console.log(' Done generating all Swagger files.');
}

generate().catch((err) => {
  console.error('Failed to generate Swagger documents:', err);
  process.exit(1);
});
