import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
export type AuthenticatedRequest = Request & { user: JwtPayload };
