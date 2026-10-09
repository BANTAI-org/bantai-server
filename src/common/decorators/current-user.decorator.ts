import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface'; // Adjust path

interface FastifyRequestWithUser extends FastifyRequest {
  user?: AuthenticatedUser;
}

export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedUser | undefined,
    ctx: ExecutionContext,
  ): unknown => {
    const request = ctx.switchToHttp().getRequest<FastifyRequestWithUser>();
    const user = request.user;

    if (!user) {
      return undefined;
    }

    return data ? user[data] : user;
  },
);
