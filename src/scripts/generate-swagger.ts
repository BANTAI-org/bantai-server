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
 * Public endpoints (no security requirements) are included if 'public' is in the array.
 */
function filterSwaggerByRole(
  document: OpenAPIObject,
  allowedRoles: string[],
): OpenAPIObject {
  const filteredPaths: Record<string, any> = {};

  for (const [path, methods] of Object.entries(document.paths || {})) {
    const filteredMethods: Record<string, any> = {};

    for (const [method, operation] of Object.entries(
      methods as Record<string, any>,
    )) {
      const op = operation as Record<string, any>;

      // Read the 'x-roles' custom extension we added via @ApiRoles()
      const endpointRoles: string[] = Array.isArray(op['x-roles'])
        ? (op['x-roles'] as string[])
        : [];

      // Safe check for the security array to avoid ESLint "unsafe member access"
      const securityArray: unknown[] = Array.isArray(op.security)
        ? op.security
        : [];
      const isPublic = securityArray.length === 0;

      // Keep endpoint if it's public and we allow public, OR if it matches a requested role
      if (
        (isPublic && allowedRoles.includes('public')) ||
        endpointRoles.some((role) => allowedRoles.includes(role))
      ) {
        filteredMethods[method] = op;
      }
    }

    // Only keep the path if it has at least one allowed method
    if (Object.keys(filteredMethods).length > 0) {
      filteredPaths[path] = filteredMethods;
    }
  }

  return { ...document, paths: filteredPaths };
}

/**
 * Helper function to generate a Swagger document.
 */
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

  // Explicitly type document as OpenAPIObject
  let document: OpenAPIObject = SwaggerModule.createDocument(
    app,
    config,
    options,
  );

  // Apply the role filter if specific roles were requested
  if (allowedRoles.length > 0) {
    document = filterSwaggerByRole(document, allowedRoles);
  }

  // Use fs.promises.writeFile (async) instead of writeFileSync
  await fs.promises.writeFile(
    `./${filename}`,
    JSON.stringify(document, null, 2),
  );

  const roleInfo = allowedRoles.length
    ? ` (Roles: ${allowedRoles.join(', ')})`
    : ' (All Roles)';
  console.log(`Generated: ${filename}${roleInfo}`);
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

  await generateSwaggerDoc(
    app,
    'command-center-swagger.json',
    'Bantai Command Center API',
    [CommandCenterModule],
  );

  // 5. ADMIN & SYSTEM TEAM (Audit, SMS, Emails)
  await generateSwaggerDoc(
    app,
    'admin-swagger.json',
    'Bantai Admin & System API',
    [AuditLogsModule, SmsModule, EmailModule, AuthModule],
  );

  // -------------------------------------------------------------------
  // 6. ROLE-SPECIFIC APPS (Filtered by @ApiRoles decorator)
  // -------------------------------------------------------------------

  // Driver Mobile App (Only endpoints for Drivers + Public)
  await generateSwaggerDoc(
    app,
    'driver-app-swagger.json',
    'Bantai Driver Mobile API',
    [],
    ['DRIVER', 'public'],
  );
  // Driver Mobile App (Only endpoints for Drivers + Public)
  await generateSwaggerDoc(
    app,
    'driver-app-swagger.json',
    'Bantai Driver Mobile API',
    [DriverModule, StorageModule, RedisModule],
    ['DRIVER', 'public'],
  );

  // Responder Mobile App (Only endpoints for Responders + Public)
  await generateSwaggerDoc(
    app,
    'responder-app-swagger.json',
    'Bantai Responder Mobile API',
    [],
    ['RESPONDER', 'public'],
  );

  // Admin Dashboard (Only endpoints for Admins/Supers + Public)
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
