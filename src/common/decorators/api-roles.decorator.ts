import { applyDecorators } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { Role } from '../enums/role-enum';

/**
 * @description
 *
 * Attaches the allowed roles to the Swagger operation as a custom "x-roles" property.
 * This allows our generation script to filter endpoints by role later.
 */
export const ApiRoles = (...roles: Role[]) => {
  return applyDecorators(ApiExtension('x-roles', roles));
};
