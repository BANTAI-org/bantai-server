import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '../../common/enums/role-enum';
import { AccountStatusEnum } from '../../modules/auth/enums/account-status.enum';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { EmailService } from '../email/email.service';
import { CommandCenterRepository } from './command-center.repository';
import { CommandCenterEntity } from './interfaces/command-center.interface';
import { CreateCommandCenterDTO } from './dto/create-command-center.dto';
import { UpdateCommandCenterDTO } from './dto/update-command-center.dto';
import { UpdateCommandCenterData } from './types/update-command-center-data.types';
import { CreateCommandCenterData } from './types/create-command-center-data.types';
import { ResponderTableRow } from './interfaces/responder-tb.interface';
import { AuthService } from '../auth/auth.service';

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
    private readonly auditLogsService: AuditLogsService,
    private readonly authService: AuthService,
  ) {}

  private async createAuditLog(
    action: AuditAction,
    actorId: string | null,
    commandCenterId: string | null,
    targetEntity: string,
    targetId: string,
    oldPayload: Record<string, unknown> | null = null,
    newPayload: Record<string, unknown> | null = null,
  ): Promise<void> {
    try {
      await this.auditLogsService.createAudit({
        actorId,
        commandCenterId,
        action,
        targetEntity,
        targetId,
        oldPayload,
        newPayload,
      });
    } catch (error) {
      // Don't let audit logging failures break the main operation
      this.logger.error(
        `Failed to create audit log for action ${action}:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

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
      const createdCenter =
        await this.commandCenterRepository.createBranch(createData);

      // Create audit log for command center creation
      await this.createAuditLog(
        AuditAction.CREATE_CC,
        null, // actorId - system/super admin action
        createdCenter.id, // commandCenterId - the newly created CC
        'command_center',
        createdCenter.id,
        null, // oldPayload
        {
          name: createdCenter.name,
          branch: createdCenter.branch,
          type: createdCenter.type,
          location: createdCenter.location,
        }, // newPayload
      );

      return createdCenter;
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

    // Get original entity for audit log
    const originalCenter = await this.commandCenterRepository.findById(id);

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

    // Create audit log for command center update
    await this.createAuditLog(
      AuditAction.UPDATE_USER, // Note: There's no specific UPDATE_CC action, using UPDATE_USER as closest match
      null, // actorId - system/super admin action
      id, // commandCenterId
      'command_center',
      id,
      originalCenter
        ? {
            name: originalCenter.name,
            branch: originalCenter.branch,
            type: originalCenter.type,
            location: originalCenter.location,
          }
        : null, // oldPayload
      {
        name: updatedCenter.name,
        branch: updatedCenter.branch,
        type: updatedCenter.type,
        location: updatedCenter.location,
      }, // newPayload
    );

    return updatedCenter;
  }

  async delete(id: string): Promise<void> {
    // Get entity for audit log before deletion
    const centerToDelete = await this.commandCenterRepository.findById(id);

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

    await this.createAuditLog(
      AuditAction.UPDATE_USER,
      null,
      id,
      'command_center',
      id,
      centerToDelete
        ? {
            name: centerToDelete.name,
            branch: centerToDelete.branch,
            type: centerToDelete.type,
            location: centerToDelete.location,
          }
        : null, // oldPayload
      null, // newPayload
    );
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
      const result =
        await this.commandCenterRepository.viewAllRespondersBranch(centerId);
      return result.data;
    } catch (error: unknown) {
      this.rethrow(error, 'list responders of', centerId);
    }
  }

  async getBranchRespondersPaginated(
    actorId: string,
    centerId: string,
    limit: number = 20,
    cursor: string | null = null,
  ): Promise<{ data: ResponderTableRow[]; nextCursor: string | null }> {
    await this.assertBranchAccess(actorId, centerId);
    try {
      return await this.commandCenterRepository.viewAllRespondersBranch(
        centerId,
        limit,
        cursor,
      );
    } catch (error: unknown) {
      this.rethrow(error, 'list responders of', centerId);
    }
  }

  async getBranchRespondersByStatusPaginated(
    actorId: string,
    centerId: string,
    status: AccountStatusEnum,
    limit: number = 20,
    cursor: string | null = null,
  ): Promise<{ data: ResponderTableRow[]; nextCursor: string | null }> {
    await this.assertBranchAccess(actorId, centerId);
    try {
      return await this.commandCenterRepository.viewAllRespondersBasedOnStatusBranch(
        centerId,
        status,
        limit,
        cursor,
      );
    } catch (error: unknown) {
      this.rethrow(error, 'list responders by status of', centerId);
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
      AuditAction.DEACTIVATE_ACCOUNT,
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
      AuditAction.ACTIVATE_ACCOUNT,
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
      AuditAction.AUTH_REVOKE_SESSION,
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
        `The reset link could not be emailed. Please try again.`,
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

  async getMyCommandCenter(
    userId: string,
  ): Promise<CommandCenterEntity | null> {
    const actorScope =
      await this.commandCenterRepository.findActorScope(userId);
    if (!actorScope?.command_center_id) {
      return null;
    }
    return await this.commandCenterRepository.findById(
      actorScope.command_center_id,
    );
  }
  async updateEmail(
    email: string,
    responderId: string,
    commandCenterId: string,
    actorId: string,
  ): Promise<string> {
    try {
      const isExistingResponderInBranch =
        await this.commandCenterRepository.findResponderInBranch(
          responderId,
          commandCenterId,
        );
      if (
        !isExistingResponderInBranch ||
        isExistingResponderInBranch === null
      ) {
        throw new BadRequestException();
      }

      // Get old email for audit logging, then update
      const oldEmail = await this.commandCenterRepository.updateEmail(
        responderId,
        email,
      );

      // Perform audit logging
      await this.auditLogsService.createAudit({
        actorId,
        commandCenterId,
        action: AuditAction.UPDATE_USER,
        targetEntity: 'user_account',
        targetId: responderId,
        oldPayload: { email: oldEmail },
        newPayload: { email: email },
        // id, createdAt handled by service
        // actorName omitted from CreateAuditLogInput per type definition
      });

      await this.authService.createActivationToken(email, responderId);

      // RETURN OLD EMAIL FOR HTTP RESPONSE
      return oldEmail;
    } catch (err: unknown) {
      this.logger.error(
        'Failed to update responder email',
        err instanceof Error ? err.stack : err,
      );
      throw new InternalServerErrorException(
        'Failed to update responder email',
      );
    }
  }
}
