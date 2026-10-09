import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '../../common/enums/role-enum';
import { EmailService } from '../email/email.service';
import { CommandCenterRepository } from './command-center.repository';
import { CommandCenterEntity } from './interfaces/command-center.interface';
import { CreateCommandCenterDTO } from './dto/create-command-center.dto';
import { UpdateCommandCenterDTO } from './dto/update-command-center.dto';
import { UpdateCommandCenterData } from './types/update-command-center-data.types';
import { CreateCommandCenterData } from './types/create-command-center-data.types';
import { ResponderTableRow } from './interfaces/responder-tb.interface';
// Matches the "expires in 1 hour" copy in EmailService.sendPasswordResetEmail.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const RESPONDER_NOT_FOUND = 'Responder not found in this command center';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

@Injectable()
export class CommandCenterService {
  private readonly logger = new Logger(CommandCenterService.name);

  constructor(
    private readonly commandCenterRepository: CommandCenterRepository,
    private readonly emailService: EmailService,
  ) {}

  private sanitizeString(value?: string): string | undefined {
    if (!value) return undefined;
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  async create(dto: CreateCommandCenterDTO): Promise<CommandCenterEntity> {
    const createData: CreateCommandCenterData = {
      ...dto,
      name: this.sanitizeString(dto.name)!,
      branch: this.sanitizeString(dto.branch)!,
    };

    try {
      return await this.commandCenterRepository.createBranch(createData);
    } catch (error: unknown) {
      this.logger.error(
        'An error occurred while creating new center',
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        'Unknown error occurred while creating new command center',
      );
    }
  }

  async update(
    id: string,
    dto: UpdateCommandCenterDTO,
  ): Promise<CommandCenterEntity> {
    const updateData: UpdateCommandCenterData = {
      ...dto,
      ...(dto.name && { name: this.sanitizeString(dto.name) }),
      ...(dto.branch && { branch: this.sanitizeString(dto.branch) }),
    };

    let updatedCenter: CommandCenterEntity | null = null;

    try {
      updatedCenter = await this.commandCenterRepository.updateBranch(
        id,
        updateData,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Database error while attempting to update command center ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        'An unexpected error occurred while updating the command center',
      );
    }

    if (!updatedCenter) {
      this.logger.warn(`Command center update failed: ID '${id}' not found`);
      throw new NotFoundException(`Command center with ID '${id}' not found`);
    }

    return updatedCenter;
  }

  async delete(id: string): Promise<void> {
    let isDeleted = false;

    try {
      isDeleted = await this.commandCenterRepository.deleteBranch(id);
    } catch (error: unknown) {
      this.logger.error(
        `Database error while attempting to delete command center ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        'An unexpected error occurred while deleting the command center',
      );
    }

    if (!isDeleted) {
      this.logger.warn(`Command center deletion failed: ID '${id}' not found`);
      throw new NotFoundException(`Command center not found`);
    }
  }

  async getAll(): Promise<CommandCenterEntity[] | null> {
    try {
      return await this.commandCenterRepository.viewAll();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error in fetching list of command centers: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'An unexpected error occurred while fetching the list of command centers',
      );
    }
  }

  // ---------------------------------------------------------------
  // Responder management (branch-scoped)
  // ---------------------------------------------------------------

  /**
   * Super may act on any branch. An admin only on their own. The actor's
   * role and branch come from the database, not the token, so a reassigned
   * or deactivated admin loses access immediately.
   */
  private async assertBranchAccess(
    actorId: string,
    centerId: string,
  ): Promise<void> {
    let actor: Awaited<ReturnType<CommandCenterRepository['findActorScope']>> =
      null;
    try {
      actor = await this.commandCenterRepository.findActorScope(actorId);
    } catch (error: unknown) {
      this.rethrow(error, 'check access for', actorId);
    }

    if (!actor) throw new ForbiddenException();
    if (actor.role === Role.SUPER) return;
    if (actor.role === Role.ADMIN && actor.command_center_id === centerId) {
      return;
    }
    throw new ForbiddenException(
      'You can only manage responders in your own command center',
    );
  }

  async getBranchResponders(
    actorId: string,
    centerId: string,
  ): Promise<ResponderTableRow[]> {
    await this.assertBranchAccess(actorId, centerId);
    try {
      return await this.commandCenterRepository.viewAllRespondersBranch(
        centerId,
      );
    } catch (error: unknown) {
      this.rethrow(error, 'list responders of', centerId);
    }
  }

  async deactivateResponder(
    actorId: string,
    centerId: string,
    responderId: string,
  ): Promise<void> {
    await this.applyToResponder(
      actorId,
      centerId,
      responderId,
      'deactivate',
      () =>
        this.commandCenterRepository.deactivateResponder(responderId, centerId),
    );
  }

  async activateResponder(
    actorId: string,
    centerId: string,
    responderId: string,
  ): Promise<void> {
    await this.applyToResponder(
      actorId,
      centerId,
      responderId,
      'activate',
      () =>
        this.commandCenterRepository.activateResponder(responderId, centerId),
    );
  }

  async revokeResponderSessions(
    actorId: string,
    centerId: string,
    responderId: string,
  ): Promise<void> {
    await this.applyToResponder(
      actorId,
      centerId,
      responderId,
      'revoke the sessions of',
      () =>
        this.commandCenterRepository.setForSessionRevoke(responderId, centerId),
    );
  }

  /**
   * Compromise response: revokes the responder's sessions, stores a hashed
   * single-use token (replacing any unused one) and emails the raw token to
   * the responder. The raw token is never returned to the admin who
   * triggered this. If the email fails, calling it again issues a new token.
   */
  async forceResponderPasswordReset(
    actorId: string,
    centerId: string,
    responderId: string,
  ): Promise<void> {
    await this.assertBranchAccess(actorId, centerId);

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    let responder: { email: string } | null = null;
    try {
      responder = await this.commandCenterRepository.setForForcedPasswordReset(
        responderId,
        centerId,
        tokenHash,
        expiresAt,
      );
    } catch (error: unknown) {
      this.rethrow(error, 'force a password reset for', responderId);
    }
    if (!responder) throw new NotFoundException(RESPONDER_NOT_FOUND);

    try {
      await this.emailService.sendPasswordResetEmail(responder.email, token);
    } catch (error: unknown) {
      this.logger.error(
        `Reset token stored but email failed for responder ${responderId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'The reset link could not be emailed. Please try again.',
      );
    }
  }

  private async applyToResponder(
    actorId: string,
    centerId: string,
    responderId: string,
    action: string,
    operation: () => Promise<boolean>,
  ): Promise<void> {
    await this.assertBranchAccess(actorId, centerId);

    let found = false;
    try {
      found = await operation();
    } catch (error: unknown) {
      this.rethrow(error, action, responderId);
    }
    if (!found) throw new NotFoundException(RESPONDER_NOT_FOUND);
  }

  private rethrow(error: unknown, action: string, subjectId: string): never {
    if (isUniqueViolation(error)) {
      throw new ConflictException(
        "Another account now uses this responder's email or mobile number, so it cannot be restored",
      );
    }
    this.logger.error(
      `Failed to ${action} ${subjectId}`,
      error instanceof Error ? error.stack : undefined,
    );
    throw new InternalServerErrorException(
      'An unexpected error occurred while processing the request',
    );
  }
}
